import type { EvidenceItem } from '../agent/SessionStore.js';
import type { BrainScratchpadState, BrainToolResult, EvidenceGateDecision } from './types.js';

const MUTATION_TOOLS = new Set([
  'file_edit',
  'write_file',
  'delete_file',
  'delete_folder',
  'terminal',
]);

function asksForMutation(text: string): boolean {
  return /\b(fix|implement|build|refactor|change|modify|edit|write|delete|add|update|patch)\b/i.test(
    text
  );
}

function claimsCompletion(text: string): boolean {
  return /\b(done|fixed|implemented|completed|working|verified|passed|successfully|selesai|beres)\b/i.test(
    text
  );
}

function hasMutation(tools: BrainToolResult[]): boolean {
  return tools.some((tool) => {
    if (!MUTATION_TOOLS.has(tool.toolName)) return false;
    if (tool.toolName !== 'terminal') return tool.status === 'success';
    return /\b(npm|bun|pnpm|yarn)\s+(install|add|remove)|\bmv\b|\bcp\b|\brm\b|>|\bchmod\b|\bgit\s+apply\b/i.test(
      String(tool.args.command || '')
    );
  });
}

export class EvidenceGate {
  private blockedTurns = new Set<string>();

  evaluate(input: {
    userMessage: string;
    assistantText: string;
    scratchpad: BrainScratchpadState;
    evidence: EvidenceItem[];
    toolResultsThisTurn: BrainToolResult[];
  }): EvidenceGateDecision {
    const mutating = asksForMutation(input.userMessage) || hasMutation(input.toolResultsThisTurn);
    if (!mutating) return { action: 'allow', reason: 'Read-only or explanatory response.' };

    const passed = input.evidence.filter((item) => item.status === 'passed');
    const failed = input.evidence.filter((item) => item.status === 'failed');
    if (failed.length > 0 && claimsCompletion(input.assistantText)) {
      const turn = input.scratchpad.turnId || 'unknown';
      if (!this.blockedTurns.has(turn)) {
        this.blockedTurns.add(turn);
        return {
          action: 'block',
          reason: `Verification failed: ${failed[failed.length - 1].label}`,
          requiredEvidence: ['typecheck', 'build', 'test', 'lint'],
          systemMessage: `[Evidence Gate] Do not finalize yet. The latest verification failed: ${failed[failed.length - 1].label}. Diagnose the failure, fix it if needed, then run an appropriate verification command before giving the final answer.`,
        };
      }
    }

    if (passed.length > 0)
      return { action: 'allow', reason: 'Verified evidence exists for this turn.' };

    if (claimsCompletion(input.assistantText)) {
      const turn = input.scratchpad.turnId || 'unknown';
      if (!this.blockedTurns.has(turn)) {
        this.blockedTurns.add(turn);
        return {
          action: 'block',
          reason: 'Completion claim needs verification evidence.',
          requiredEvidence: ['typecheck', 'build', 'test', 'lint'],
          systemMessage:
            '[Evidence Gate] You are about to claim the work is done, but no build/typecheck/test/lint evidence is recorded for this turn. Run the most relevant verification command, or revise the final answer to clearly say verification was not run.',
        };
      }
      return {
        action: 'allow_with_caveat',
        reason: 'No verification evidence was recorded after changes; avoid implying tests passed.',
      };
    }

    return { action: 'allow', reason: 'No unsupported completion claim.' };
  }
}
