import { createHash } from 'crypto';

export type GuardedToolCall = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type DuplicateToolVerdict = 'ok' | 'block' | 'halt';

export const REPEAT_BLOCK_AT = 3;
export const REPEAT_HALT_AT = 6;

function stableToolArgs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableToolArgs);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith('_'))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableToolArgs(nested)])
    );
  }
  return value;
}

export function toolCallSignature(call: GuardedToolCall): string {
  const normalizedArgs = JSON.stringify(stableToolArgs(call.arguments || {}));
  const argsHash = createHash('sha1').update(normalizedArgs).digest('hex').slice(0, 12);
  return `${call.name}:${argsHash}`;
}

export class DuplicateToolCallGuard {
  private repeatStreak = 0;
  private lastSignature?: string;

  check(call: GuardedToolCall): DuplicateToolVerdict {
    const signature = toolCallSignature(call);
    const streak = signature === this.lastSignature ? this.repeatStreak + 1 : 1;
    this.repeatStreak = streak;
    this.lastSignature = signature;
    if (streak >= REPEAT_HALT_AT) return 'halt';
    if (streak >= REPEAT_BLOCK_AT) return 'block';
    return 'ok';
  }
}
