import type { AurixConfig } from '../agent/Config.js';
import type { EvidenceItem } from '../agent/SessionStore.js';
import { resolveModelCapabilities } from './ModelCapabilities.js';
import { RepoBrain } from './RepoBrain.js';
import { Scratchpad } from './Scratchpad.js';
import { BrowserStateFusion } from './BrowserStateFusion.js';
import { EvidenceGate } from './EvidenceGate.js';
import type { BrainToolResult, ModelCapabilities, RepoBrainEntry } from './types.js';

export class AurixBrain {
  private capabilities: ModelCapabilities;
  private repo?: RepoBrain;
  private scratchpad: Scratchpad;
  private browserFusion = new BrowserStateFusion();
  private evidenceGate = new EvidenceGate();

  constructor(input: { config: AurixConfig; sessionId: string; cwd: string }) {
    this.capabilities = resolveModelCapabilities(input.config);
    if (input.config.brain?.repoIndex !== false) {
      this.repo = new RepoBrain(input.cwd);
    }
    this.scratchpad = new Scratchpad(input.sessionId);
  }

  startTurn(turnId: string, userMessage: string): void {
    this.scratchpad.startTurn(turnId, userMessage);
  }

  getCapabilities(): ModelCapabilities {
    return { ...this.capabilities, notes: [...(this.capabilities.notes || [])] };
  }

  getRepoSummary(): string {
    if (!this.repo) return '';
    try {
      return this.repo.summarize();
    } catch {
      return '';
    }
  }

  rebuildRepoIndex(): string {
    if (!this.repo) return 'Repo index disabled.';
    const index = this.repo.rebuild();
    return `Indexed ${index.entries.length} files at ${index.generatedAt}`;
  }

  searchRepo(query: string, limit = 8): RepoBrainEntry[] {
    if (!this.repo) return [];
    try {
      return this.repo.search(query, limit);
    } catch {
      return [];
    }
  }

  recordToolResult(input: BrainToolResult): void {
    this.scratchpad.recordToolResult(input);
    if (input.toolName === 'browser')
      this.browserFusion.recordBrowserResult(input.args, input.result);
  }

  recordAssistantText(text: string): void {
    this.scratchpad.recordAssistantText(text);
  }

  getScratchpadState() {
    return this.scratchpad.getState();
  }

  buildTransientContext(): string {
    const parts: string[] = [];
    const caps = this.capabilities;
    parts.push(
      `[BRAIN CAPABILITIES]\nvision=${caps.vision} tools=${caps.tools} json=${caps.json} source=${caps.source}${caps.notes?.length ? ` notes=${caps.notes.join('; ')}` : ''}\n[/BRAIN CAPABILITIES]`
    );
    const repoSummary = this.getRepoSummary();
    if (repoSummary) parts.push(`[REPO BRAIN]\n${repoSummary}\n[/REPO BRAIN]`);
    const scratch = this.scratchpad.renderForPrompt();
    if (scratch) parts.push(scratch);
    const browser = this.browserFusion.renderForPrompt();
    if (browser) parts.push(browser);
    return parts.join('\n\n');
  }

  evaluateFinalAnswer(input: {
    userMessage: string;
    assistantText: string;
    evidence: EvidenceItem[];
    toolResultsThisTurn: BrainToolResult[];
  }) {
    return this.evidenceGate.evaluate({
      ...input,
      scratchpad: this.scratchpad.getState(),
    });
  }
}
