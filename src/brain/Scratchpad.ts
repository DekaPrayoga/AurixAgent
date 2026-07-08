import { redactSessionText } from '../agent/SessionStore.js';
import type { BrainScratchpadState, BrainToolResult } from './types.js';

const MAX_ITEMS = 12;

function pushUnique(list: string[], value: string): void {
  const cleaned = redactSessionText(value).replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!cleaned || list.includes(cleaned)) return;
  list.push(cleaned);
  while (list.length > MAX_ITEMS) list.shift();
}

function extractPaths(text: string): string[] {
  const matches = text.match(/(?:^|\s)(\/?(?:[\w.-]+\/)+[\w.@-]+\.[A-Za-z0-9]+)/g) || [];
  return matches.map((m) => m.trim()).slice(0, 6);
}

export class Scratchpad {
  private state: BrainScratchpadState;

  constructor(sessionId: string) {
    this.state = {
      sessionId,
      facts: [],
      openQuestions: [],
      nextActions: [],
      risks: [],
      evidenceRefs: [],
    };
  }

  startTurn(turnId: string, userMessage: string): void {
    this.state.turnId = turnId;
    this.state.nextActions = [];
    pushUnique(this.state.facts, `User request: ${userMessage}`);
  }

  recordToolResult(input: BrainToolResult): void {
    const action = input.args?.action ? ` ${String(input.args.action)}` : '';
    if (input.status === 'success') {
      pushUnique(this.state.facts, `${input.toolName}${action} succeeded.`);
    } else {
      pushUnique(
        this.state.risks,
        `${input.toolName}${action} ${input.status}${input.errorType ? ` (${input.errorType})` : ''}: ${input.result.slice(0, 180)}`
      );
      pushUnique(
        this.state.nextActions,
        `Diagnose ${input.toolName}${action} failure before retrying.`
      );
    }

    for (const file of extractPaths(input.result))
      pushUnique(this.state.facts, `Referenced file: ${file}`);

    if (input.toolName === 'terminal') {
      const command = String(input.args.command || '').trim();
      if (
        /\b(tsc|typecheck|test|vitest|jest|mocha|pytest|lint|build|npm run build)\b/i.test(command)
      ) {
        pushUnique(
          this.state.evidenceRefs,
          `${input.status === 'success' ? 'Passed' : 'Failed'}: ${command}`
        );
      }
    }

    if (/\b(todo|next|remaining|follow[- ]?up)\b/i.test(input.result)) {
      pushUnique(this.state.nextActions, input.result.slice(0, 200));
    }
  }

  recordAssistantText(text: string): void {
    if (/\b(need|needs|remaining|next)\b/i.test(text))
      pushUnique(this.state.nextActions, text.slice(0, 200));
  }

  getState(): BrainScratchpadState {
    return {
      ...this.state,
      facts: [...this.state.facts],
      openQuestions: [...this.state.openQuestions],
      nextActions: [...this.state.nextActions],
      risks: [...this.state.risks],
      evidenceRefs: [...this.state.evidenceRefs],
    };
  }

  renderForPrompt(maxChars = 1600): string {
    const sections = [
      ['Facts', this.state.facts],
      ['Open questions', this.state.openQuestions],
      ['Next actions', this.state.nextActions],
      ['Risks', this.state.risks],
      ['Evidence', this.state.evidenceRefs],
    ]
      .filter(([, items]) => (items as string[]).length)
      .map(
        ([label, items]) =>
          `${label}:\n${(items as string[]).map((item) => `- ${item}`).join('\n')}`
      );
    if (!sections.length) return '';
    const text = `[BRAIN SCRATCHPAD]\n${sections.join('\n')}\n[/BRAIN SCRATCHPAD]`;
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n...\n[/BRAIN SCRATCHPAD]` : text;
  }
}
