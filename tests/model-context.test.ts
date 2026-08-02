import { describe, expect, test } from 'bun:test';
import {
  fallbackModelContextLimit,
  parseContextMarker,
  registryModelLimits,
  resolveModelContextInfo,
} from '../src/agent/ModelContext.js';
import { AURIX_FREE_MODEL_ID } from '../src/agent/AurixFreeModel.js';

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

  test('uses a deterministic budget for the built-in Aurix free model', async () => {
    const info = await resolveModelContextInfo({ provider: 'openai', apiKey: '', model: AURIX_FREE_MODEL_ID });
    expect(info.context).toBe(1_000_000);
    expect(info.source).toBe('catalog');
  });

  test('an unknown model falls back rather than guessing', () => {
    // Guessing high makes the agent compact too late and the provider rejects the request.
    // Unknown ids stay on the conservative default; `contextLimit` in config pins the truth.
    expect(fallbackModelContextLimit('some/unheard-of-model')).toBe(256_000);
  });

  test('operator-supplied values cover what the registry does not carry', () => {
    // These four are absent from LiteLLM, so without the catalog they fell to 256k.
    expect(fallbackModelContextLimit('grok-4.5')).toBe(500_000);
    expect(fallbackModelContextLimit('ih/free/grok/grok-4.5')).toBe(500_000);
    expect(fallbackModelContextLimit('glm-5.2')).toBe(1_000_000);
    expect(fallbackModelContextLimit('ih/zai/glm-5.2')).toBe(1_000_000);
    expect(fallbackModelContextLimit('kimi-k3')).toBe(1_000_000);
    expect(fallbackModelContextLimit('deepseek-v4-pro')).toBe(1_000_000);
    expect(fallbackModelContextLimit('deepseek-v4-flash')).toBe(1_000_000);
  });

  test('the new entries do not shadow existing deepseek models', () => {
    // /deepseek-v4-(pro|flash)/ must not swallow deepseek-chat, which is a real 131k model.
    expect(fallbackModelContextLimit('deepseek-chat')).toBe(131_072);
  });
});

describe('vendored model registry', () => {
  test('covers the long tail the curated catalog deliberately skips', () => {
    expect(registryModelLimits('deepseek-chat')?.input).toBe(131_072);
    expect(registryModelLimits('gemini-2.5-pro')?.input).toBe(1_048_576);
    expect(registryModelLimits('mistral/mistral-large-latest')?.input).toBe(262_144);
  });

  test('strips router prefixes to find the bare model id', () => {
    // Config ids look like "cc/claude-opus-4-7"; the registry keys are bare.
    expect(registryModelLimits('cc/claude-opus-4-7')?.input).toBe(1_000_000);
    expect(registryModelLimits('kr/claude-opus-4.8')?.input).toBe(1_000_000);
  });

  test('carries output limits, which the curated catalog does not', () => {
    expect(registryModelLimits('claude-opus-4-7')?.output).toBe(128_000);
    expect(registryModelLimits('gpt-4o')?.output).toBe(16_384);
  });

  test('independently agrees with every curated catalog value', () => {
    // If these ever diverge, one of the two is wrong and the mismatch should be looked at.
    for (const [id, expected] of [
      ['claude-opus-4-7', 1_000_000],
      ['claude-opus-4-8', 1_000_000],
      ['claude-sonnet-5', 1_000_000],
      ['claude-haiku-4-5', 200_000],
      ['gpt-4o', 128_000],
    ] as [string, number][]) {
      expect(registryModelLimits(id)?.input).toBe(expected);
      expect(fallbackModelContextLimit(id)).toBe(expected);
    }
  });

  test('reports nothing for a model it has never heard of', () => {
    expect(registryModelLimits('totally/made/up-model-xyz')).toBeUndefined();
  });

  test('an explicit marker in the id still wins', () => {
    expect(parseContextMarker('claude-opus-5[1m]')).toBe(M);
    expect(parseContextMarker('some-model-128k')).toBe(128_000);
    expect(parseContextMarker('plain-model')).toBeUndefined();
  });
});
