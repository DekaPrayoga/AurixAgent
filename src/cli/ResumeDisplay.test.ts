// @ts-ignore Bun injects this module in the test runner; production typecheck excludes its ambient types.
import { describe, expect, test } from 'bun:test';
import type { Message } from '../providers/index.js';
import { buildResumedDisplayMessages } from './ResumeDisplay.js';

function history(count: number, chars: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index === 0 ? 'system' : index % 2 === 0 ? 'user' : 'assistant',
    content: String(index).padEnd(chars, 'x'),
  } as Message));
}

describe('resumed session display', () => {
  test('keeps full model history separate from bounded UI history', () => {
    const full = history(500, 1_000);
    const display = buildResumedDisplayMessages(full, 'session-a', { maxMessages: 40, maxChars: 50_000 });
    expect(full).toHaveLength(500);
    expect(display).toHaveLength(40);
    expect(display.at(-1)?.content.startsWith('499')).toBe(true);
    expect(display[0].id).toBe('session-a:460');
  });

  test('caps each historical message without mutating source content', () => {
    const full = history(3, 100_000);
    const original = full[2].content;
    const display = buildResumedDisplayMessages(full, 'session-b', { maxMessageChars: 8_000, maxChars: 20_000 });
    expect(display.at(-1)?.content.length).toBeLessThan(8_200);
    expect(display.at(-1)?.content).toContain('more characters hidden');
    expect(full[2].content).toBe(original);
  });
});
