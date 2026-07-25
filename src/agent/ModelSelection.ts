import type { AgentLoop } from './AgentLoop.js';
import type { AurixConfig } from './Config.js';
import { saveConfig } from './Config.js';
import type { ModelContextInfo } from './ModelContext.js';
import type { DiscoveredModel } from './ModelDiscovery.js';

export interface ModelPickerItem {
  id: string;
  label: string;
  description?: string;
  category?: string;
  current?: boolean;
  custom?: boolean;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function startsWithDigit(value: string): boolean {
  return /^\d/.test(value.trim());
}

export function naturalModelCompare(a: string, b: string): number {
  const aDigit = startsWithDigit(a);
  const bDigit = startsWithDigit(b);
  if (aDigit !== bDigit) return aDigit ? -1 : 1;
  return collator.compare(a, b);
}

function inferCategory(model: DiscoveredModel): string {
  if (model.provider) return model.provider;
  const first = model.id.includes('/') ? model.id.split('/')[0] : '';
  return first || 'Models';
}

export function toModelPickerItems(
  models: DiscoveredModel[],
  currentModel?: string
): ModelPickerItem[] {
  return models
    .map((model) => ({
      id: model.id,
      label: model.label || model.id,
      description: model.description || (model.label !== model.id ? model.id : undefined),
      category: inferCategory(model),
      current: model.id.toLowerCase() === currentModel?.toLowerCase(),
    }))
    .sort((a, b) => naturalModelCompare(a.id, b.id));
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function fuzzyScore(query: string, value: string): number {
  const needle = normalizeSearchText(query);
  const haystack = normalizeSearchText(value);
  if (!needle) return 0;
  if (haystack === needle) return -400;
  if (haystack.startsWith(needle)) return -300 + haystack.length / 1000;
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return -200 + direct;
  let cursor = 0;
  let gap = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return Number.POSITIVE_INFINITY;
    gap += found - cursor;
    cursor = found + 1;
  }
  return gap + 100;
}

export function searchModelItems(items: ModelPickerItem[], query: string): ModelPickerItem[] {
  const trimmed = query.trim();
  if (!trimmed) return items;
  return items
    .map((item) => {
      const idScore = fuzzyScore(trimmed, item.id);
      const labelScore = fuzzyScore(trimmed, item.label) + 5;
      const categoryScore = fuzzyScore(trimmed, item.category || '') + 20;
      return { item, score: Math.min(idScore, labelScore, categoryScore) };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || naturalModelCompare(a.item.id, b.item.id))
    .map((entry) => entry.item);
}

export function paginateModelItems<T>(
  items: T[],
  page: number,
  pageSize: number
): { items: T[]; page: number; pageSize: number; total: number; totalPages: number } {
  const safeSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(items.length / safeSize));
  const safePage = Math.max(0, Math.min(Math.floor(page), totalPages - 1));
  return {
    items: items.slice(safePage * safeSize, safePage * safeSize + safeSize),
    page: safePage,
    pageSize: safeSize,
    total: items.length,
    totalPages,
  };
}

export interface AppliedModelSelection {
  model: string;
  context: ModelContextInfo;
}

export async function applyModelSelection(
  agent: AgentLoop,
  config: AurixConfig,
  rawModelId: string
): Promise<AppliedModelSelection> {
  const model = rawModelId.trim();
  if (!model) throw new Error('Model ID is required.');
  const context = await agent.applyProviderConfig(
    { model },
    { preferFreshModels: true }
  );
  config.model = model;
  saveConfig(config);
  return { model, context };
}
