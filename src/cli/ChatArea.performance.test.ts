// @ts-ignore Bun injects this module in the test runner; production typecheck excludes its ambient types.
import { describe, expect, test } from 'bun:test';
import type { ChatMessage } from './ChatArea.js';
import { selectVisibleMessages } from './ChatArea.js';

function messages(count: number, chars: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: String(index).padEnd(chars, 'x'),
    timestamp: new Date(index),
  }));
}

describe('resumed session viewport', () => {
  test('limits mounted history by message count', () => {
    const all = messages(200, 10);
    const result = selectVisibleMessages(all, 0, 40, 100_000);
    expect(result.visible).toHaveLength(40);
    expect(result.start).toBe(160);
    expect(result.visible.at(-1)?.content.startsWith('199')).toBe(true);
  });

  test('limits mounted history by total character budget', () => {
    const all = messages(20, 10_000);
    const result = selectVisibleMessages(all, 0, 40, 35_000);
    expect(result.visible).toHaveLength(3);
    expect(result.visible.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(35_000);
    expect(result.visible.at(-1)?.content.startsWith('19')).toBe(true);
  });

  test('respects scroll offset while keeping a bounded window', () => {
    const all = messages(100, 100);
    const result = selectVisibleMessages(all, 10, 20, 100_000);
    expect(result.visible).toHaveLength(20);
    expect(result.visible.at(-1)?.content.startsWith('89')).toBe(true);
  });
});
