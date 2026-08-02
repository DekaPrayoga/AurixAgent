import type { DiscoveredModel } from './ModelDiscovery.js';

export const AURIX_FREE_MODEL_ID = 'aurix/deepseek-v4-flash-free';
export const AURIX_FREE_UPSTREAM_MODEL_ID = 'deepseek-v4-flash-free';
export const AURIX_FREE_CONTEXT_LIMIT = 1_000_000;

export const AURIX_FREE_MODEL: DiscoveredModel = {
  id: AURIX_FREE_MODEL_ID,
  label: 'Aurix Free — DeepSeek V4 Flash',
  provider: 'Aurix Free',
  description: 'Free · No API key · Public third-party inference; prompts and tool data leave your device',
};

export function isAurixFreeModel(model: string): boolean {
  return model.trim().toLowerCase() === AURIX_FREE_MODEL_ID;
}

export function assertAurixFreeModel(model: string): void {
  if (!isAurixFreeModel(model)) throw new Error(`Unknown Aurix model: ${model}`);
}

export function mergeAurixFreeModel(models: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set<string>();
  return [AURIX_FREE_MODEL, ...models].filter((model) => {
    const key = model.id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
