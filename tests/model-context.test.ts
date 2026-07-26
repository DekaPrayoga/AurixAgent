import { describe, expect, test } from 'bun:test';
import { fallbackModelContextLimit, parseContextMarker } from '../src/agent/ModelContext.js';

const M = 1_000_000;
const K200 = 200_000;

describe('context catalog', () => {
  test('the 1M Claude generation is recognised', () => {
    // The catalog stopped at claude-sonnet-4, so every newer Opus fell through to the
    // 256k blind default — the agent compacted at a quarter of its real window.
    for (const id of [
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-sonnet-4-6',
      'claude-fable-5',
      'claude-mythos-5',
    ]) {
      expect(fallbackModelContextLimit(id)).toBe(M);
    }
  });

  test('200k Claude models are not inflated to 1M', () => {
    for (const id of ['claude-haiku-4-5', 'claude-opus-4-5', 'claude-sonnet-4', 'claude-3-7-sonnet']) {
      expect(fallbackModelContextLimit(id)).toBe(K200);
    }
  });

  test('router prefixes and separator styles both resolve', () => {
    // 9router publishes "kr/claude-opus-4.7" while the config holds "cc/claude-opus-4-7".
    expect(fallbackModelContextLimit('cc/claude-opus-4-7')).toBe(M);
    expect(fallbackModelContextLimit('kr/claude-opus-4.7')).toBe(M);
    expect(fallbackModelContextLimit('kr/claude-opus-4_7')).toBe(M);
    expect(fallbackModelContextLimit('kr/claude-opus-4.7-thinking-agentic')).toBe(M);
  });

  test('non-Anthropic families keep their real windows', () => {
    expect(fallbackModelContextLimit('gpt-4.1')).toBe(M);
    expect(fallbackModelContextLimit('gpt-4o')).toBe(128_000);
    expect(fallbackModelContextLimit('gemini-2-flash')).toBe(M);
  });

  test('an unknown model falls back rather than guessing', () => {
    // Guessing high makes the agent compact too late and the provider rejects the request.
    // Unknown ids stay on the conservative default; `contextLimit` in config pins the truth.
    expect(fallbackModelContextLimit('ih/free/grok/grok-4.5')).toBe(256_000);
    expect(fallbackModelContextLimit('some/unheard-of-model')).toBe(256_000);
  });

  test('an explicit marker in the id still wins', () => {
    expect(parseContextMarker('claude-opus-5[1m]')).toBe(M);
    expect(parseContextMarker('some-model-128k')).toBe(128_000);
    expect(parseContextMarker('plain-model')).toBeUndefined();
  });
});
