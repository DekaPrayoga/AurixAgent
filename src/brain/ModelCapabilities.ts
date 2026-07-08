import type { AurixConfig } from '../agent/Config.js';
import type { ModelCapabilities } from './types.js';

const VISION_MODELS = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'claude-3',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-5',
  'gemini',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'llava',
  'pixtral',
  'vision',
  'vl',
];

const JSON_MODELS = [
  'gpt-4',
  'gpt-5',
  'claude',
  'gemini',
  'qwen',
  'llama-3',
  'mistral',
  'deepseek',
];
const COMPLETION_ONLY = ['davinci', 'curie', 'babbage', 'ada', 'instruct'];

function matchesAny(value: string, needles: string[]): boolean {
  return needles.some((n) => value.includes(n));
}

export function resolveModelCapabilities(config: AurixConfig): ModelCapabilities {
  const override = config.brain?.capabilities;
  const provider = (config.provider || 'custom').toLowerCase();
  const model = (config.model || '').toLowerCase();
  const notes: string[] = [];

  const inferredVision = matchesAny(model, VISION_MODELS);
  const inferredCompletionOnly = matchesAny(model, COMPLETION_ONLY);
  const inferredTools = !inferredCompletionOnly;
  const inferredJson =
    provider === 'openai' ||
    provider === 'anthropic' ||
    provider === 'custom-anthropic' ||
    matchesAny(model, JSON_MODELS);

  let source: ModelCapabilities['source'] = 'heuristic';
  if (!model) {
    source = 'unknown';
    notes.push('Model name is empty; using conservative defaults.');
  }
  if (provider === 'custom' && !config.apiStyle) {
    notes.push(
      'Custom provider without apiStyle; tool support assumes OpenAI/Anthropic-compatible chat.'
    );
  }
  if (inferredCompletionOnly)
    notes.push('Model name looks completion-only; tool support disabled.');

  const capabilities: ModelCapabilities = {
    vision: inferredVision,
    tools: inferredTools,
    json: inferredJson,
    source,
    notes,
  };

  if (override) {
    return {
      ...capabilities,
      ...override,
      source: 'config',
      notes: [...notes, 'Overridden by config.brain.capabilities.'],
    };
  }

  return capabilities;
}
