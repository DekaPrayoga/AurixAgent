import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import type { AurixConfig } from './Config.js';
import {
  fetchModelPayload,
  modelEndpointCandidates,
  modelListFromPayload,
} from './ModelDiscovery.js';

import MODEL_REGISTRY from './model-registry.json' with { type: 'json' };
import { AURIX_FREE_CONTEXT_LIMIT, isAurixFreeModel } from './AurixFreeModel.js';

/**
 * Shape of model-registry.json: id -> [maxInputTokens, maxOutputTokens?].
 * Typed as number[] because a JSON import widens tuples to arrays; index 0 is always
 * present (the generator drops entries without a positive input window).
 */
interface ModelRegistryFile {
  models: Record<string, number[]>;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const FALLBACK_CONTEXT_LIMIT = 256_000;
const METADATA_TIMEOUT_MS = 3000;

const CONTEXT_KEYS = [
  'context_length',
  'context_window',
  'context_limit',
  'contextLimit',
  'contextWindow',
  'max_context_length',
  'max_context_window',
  'max_model_len',
  'max_model_length',
  'max_sequence_length',
  'max_seq_len',
  'token_limit',
  'tokens',
];

const INPUT_KEYS = [
  'input_token_limit',
  'max_input_tokens',
  'max_input_token_limit',
  'input_tokens',
  'prompt_token_limit',
  'max_prompt_tokens',
];

const OUTPUT_KEYS = [
  'output_token_limit',
  'max_output_tokens',
  'max_completion_tokens',
  'completion_token_limit',
  'available_output_tokens',
  'availableOutputTokens',
];

export type ModelContextSource =
  | 'config'
  | 'env'
  | 'cache'
  | 'models'
  | 'marker'
  | 'catalog'
  | 'registry'
  | 'fallback';

export interface ModelContextInfo {
  context: number;
  input?: number;
  output?: number;
  source: ModelContextSource;
  confidence: 'explicit' | 'high' | 'medium' | 'low';
  endpoint?: string;
  updatedAt: number;
}

interface ContextCacheEntry {
  contextLength?: number;
  context?: number;
  input?: number;
  output?: number;
  source?: ModelContextSource;
  confidence?: ModelContextInfo['confidence'];
  endpoint?: string;
  updatedAt: number;
}

function cachePath(): string {
  return path.join(os.homedir(), '.aurix', 'state', 'model-context-cache.json');
}

function cacheKey(config: AurixConfig): string {
  const endpoint = config.baseUrl || 'default';
  const provider = config.provider || 'default';
  const style = config.apiStyle || 'auto';
  const credential = config.apiKey
    ? createHash('sha256').update(config.apiKey).digest('hex').slice(0, 12)
    : 'anonymous';
  return `${config.model}@${endpoint}@${provider}:${style}:${credential}`;
}

function readCache(): Record<string, ContextCacheEntry> {
  try {
    const file = cachePath();
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, ContextCacheEntry>): void {
  try {
    const file = cachePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
  } catch {}
}

function cleanNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  if (typeof raw !== 'string') return undefined;
  const parsed = Number(raw.trim().replace(/,/g, '').replace(/_/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function envNumber(name: string): number | undefined {
  return cleanNumber(process.env[name]);
}

function configInfo(config: AurixConfig): ModelContextInfo | undefined {
  const context = config.contextLimit ?? envNumber('AURIX_CONTEXT_LIMIT');
  const input = config.contextInputLimit ?? envNumber('AURIX_CONTEXT_INPUT_LIMIT');
  const output = config.contextOutputLimit ?? envNumber('AURIX_CONTEXT_OUTPUT_LIMIT');
  if (!context && !input && !output) return undefined;
  return {
    context: context || input || FALLBACK_CONTEXT_LIMIT,
    input,
    output,
    source: config.contextLimit || config.contextInputLimit || config.contextOutputLimit ? 'config' : 'env',
    confidence: 'explicit',
    updatedAt: Date.now(),
  };
}

export function getCachedModelContextInfo(config: AurixConfig): ModelContextInfo | undefined {
  const entry = readCache()[cacheKey(config)];
  const context = entry ? entry.context ?? entry.contextLength : undefined;
  if (!entry || !Number.isFinite(context) || !context || context <= 0) return undefined;
  if (Date.now() - entry.updatedAt > CACHE_TTL_MS) return undefined;
  return {
    context: Math.round(context),
    input: cleanNumber(entry.input),
    output: cleanNumber(entry.output),
    source: entry.source || 'cache',
    confidence: entry.confidence || 'high',
    endpoint: entry.endpoint,
    updatedAt: entry.updatedAt,
  };
}

export function getCachedModelContextLimit(config: AurixConfig): number | undefined {
  return getCachedModelContextInfo(config)?.context;
}

export function saveCachedModelContextInfo(config: AurixConfig, info: ModelContextInfo): void {
  if (!Number.isFinite(info.context) || info.context <= 0) return;
  const cache = readCache();
  cache[cacheKey(config)] = {
    contextLength: Math.round(info.context),
    context: Math.round(info.context),
    input: info.input,
    output: info.output,
    source: info.source,
    confidence: info.confidence,
    endpoint: info.endpoint,
    updatedAt: info.updatedAt || Date.now(),
  };
  writeCache(cache);
}

export function saveCachedModelContextLimit(config: AurixConfig, contextLength: number): void {
  saveCachedModelContextInfo(config, {
    context: contextLength,
    source: 'cache',
    confidence: 'high',
    updatedAt: Date.now(),
  });
}

export function parseProviderContextLimitFromError(error: unknown): number | undefined {
  return parseContextErrorInfo(error).context;
}

export function parseProviderOutputLimitFromError(error: unknown): number | undefined {
  return parseContextErrorInfo(error).output;
}

export function parseContextErrorInfo(error: unknown): Partial<Pick<ModelContextInfo, 'context' | 'output'>> {
  const text = error instanceof Error ? error.message : String(error || '');
  const contextPatterns = [
    /maximum context length is\s*([\d,]{4,})\s*(?:tokens?|token)?/gi,
    /context(?: length| window)?(?: limit)?(?: is|:)?\s*([\d,]{4,})\s*(?:tokens?|token)/gi,
    /(?:context|prompt)[^\n]{0,80}(?:maximum|limit)[^\d]{0,40}([\d,]{4,})\s*(?:tokens?|token)?/gi,
    /requested\s+[\d,]{4,}\s*(?:tokens?|token)[^\n]{0,100}(?:maximum context|context limit)[^\d]{0,40}([\d,]{4,})/gi,
  ];
  const outputPatterns = [
    /(?:max(?:imum)?\s*)?(?:output|completion)\s*(?:tokens?)?\s*(?:limit|cap|maximum)?\s*(?:is|:)?\s*([\d,]{3,})\s*(?:tokens?|token)/gi,
    /available\s+(?:output|completion)\s*(?:tokens?)?\s*(?:is|:)?\s*([\d,]{3,})/gi,
  ];
  const scan = (patterns: RegExp[], min: number, max: number) => {
    const values: number[] = [];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const value = cleanNumber(match[1]);
        if (value && value >= min && value <= max) values.push(value);
      }
    }
    return values.length ? Math.min(...values) : undefined;
  };
  return { context: scan(contextPatterns, 4_000, 2_000_000), output: scan(outputPatterns, 256, 500_000) };
}

export function parseContextMarker(model: string): number | undefined {
  const lower = model.toLowerCase();
  if (/\[(?:1m|1000k|1_000k)\]|\b(?:1m|1000k|1-million|million-context)\b/.test(lower)) return 1_000_000;
  const match = lower.match(/(?:^|[-_\s/\[])(\d+(?:\.\d+)?)(k|m)(?:[-_\s/\]]|$)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(match[2] === 'm' ? value * 1_000_000 : value * 1_000);
}

export function fallbackModelContextLimit(model: string): number {
  return parseContextMarker(model) || familyCatalogContext(model) || registryModelLimits(model)?.input || FALLBACK_CONTEXT_LIMIT;
}

/**
 * Known context windows, checked in order — the first match wins, so the most specific
 * entry comes first. Only add a model you can actually confirm: guessing high makes the
 * agent compact too late and the request dies at the provider, guessing low wastes window.
 * Anything absent falls through to FALLBACK_CONTEXT_LIMIT, and the operator can always
 * pin the real number with `contextLimit` in ~/.aurix/config.yaml.
 *
 * Patterns are matched against the model id with '.' and '_' folded to '-', so a router
 * prefix and either separator style both hit: "cc/claude-opus-4-7", "kr/claude-opus-4.7".
 */
const CONTEXT_CATALOG: { match: RegExp; context: number }[] = [
  // Operator-supplied values for models the vendored registry does not carry.
  // These run on the 9router, so the id arrives prefixed ("ih/free/grok/grok-4.5",
  // "ih/zai/glm-5.2") and the patterns stay unanchored to match the tail.
  { match: /grok-4-5/, context: 500_000 },
  { match: /glm-5-2/, context: 1_000_000 },
  { match: /kimi-k3/, context: 1_000_000 },
  { match: /deepseek-v4-(?:pro|flash)/, context: 1_000_000 },

  // Anthropic — the 4.6-and-newer generation moved to a 1M window.
  { match: /claude-(?:fable|mythos)-5/, context: 1_000_000 },
  { match: /claude-opus-4-(?:6|7|8)/, context: 1_000_000 },
  { match: /claude-sonnet-(?:5|4-6)/, context: 1_000_000 },
  { match: /claude-haiku-4-5/, context: 200_000 },
  { match: /claude-(?:opus|sonnet)-4-5/, context: 200_000 },
  { match: /claude-(?:3-5|3-7|opus-4|sonnet-4|haiku-3)/, context: 200_000 },
  { match: /claude-3/, context: 200_000 },
  // Google
  { match: /gemini-(?:1-5|2|3)/, context: 1_000_000 },
  // OpenAI — 4.1 is the 1M one; 4o and turbo stayed at 128k.
  { match: /gpt-4-1(?:$|[^0-9])/, context: 1_000_000 },
  { match: /gpt-4o|gpt-4-turbo/, context: 128_000 },
];

function familyCatalogContext(model: string): number | undefined {
  // Fold separators so "claude-opus-4.7", "claude-opus-4_7" and "claude-opus-4-7" all match.
  const normalized = model.toLowerCase().replace(/[._]/g, '-');
  return CONTEXT_CATALOG.find((entry) => entry.match.test(normalized))?.context;
}

/**
 * Candidate keys for the vendored registry, most specific first. Router ids carry a prefix
 * the registry does not know ("cc/claude-opus-4-7", "ih/free/grok/grok-4.5"), and providers
 * disagree on '.' vs '-', so try the whole id, then progressively shorter tails.
 */
function registryLookupKeys(model: string): string[] {
  const lower = model.trim().toLowerCase();
  const segments = lower.split('/').filter(Boolean);
  const candidates = new Set<string>();
  for (let i = 0; i < segments.length; i++) {
    const tail = segments.slice(i).join('/');
    candidates.add(tail);
    candidates.add(tail.replace(/[._]/g, '-'));
  }
  return [...candidates];
}

/**
 * Looks the model up in the LiteLLM-derived registry vendored at model-registry.json.
 * Sits below the curated catalog: the catalog is tiny and can be hotfixed the day a model
 * ships, while the registry covers the long tail we would otherwise have to guess at.
 */
export function registryModelLimits(model: string): { input: number; output?: number } | undefined {
  const table = (MODEL_REGISTRY as ModelRegistryFile).models;
  for (const key of registryLookupKeys(model)) {
    const hit = table[key];
    if (hit && hit[0] > 0) return { input: hit[0], output: hit[1] };
  }
  const basename = model.trim().toLowerCase().split('/').filter(Boolean).pop()?.replace(/[._]/g, '-');
  if (!basename) return undefined;
  const matches = Object.entries(table).filter(([key, limits]) =>
    limits[0] > 0 && key.toLowerCase().split('/').pop()?.replace(/[._]/g, '-') === basename
  );
  if (matches.length !== 1) return undefined;
  const limits = matches[0][1];
  return { input: limits[0], output: limits[1] };
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function modelMatches(candidate: string, target: string): boolean {
  const c = normalizeModelId(candidate);
  const t = normalizeModelId(target);
  if (!c || !t) return false;
  if (c === t) return true;
  const cBare = c.includes('/') ? c.split('/').pop() || c : c;
  const tBare = t.includes('/') ? t.split('/').pop() || t : t;
  return cBare === tBare || c.endsWith(`/${tBare}`) || t.endsWith(`/${cBare}`);
}

function extractFirstNumber(value: unknown, keys: string[]): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of keys) {
    const parsed = cleanNumber(obj[key]);
    if (parsed) return parsed;
  }
  for (const nested of Object.values(obj)) {
    const found = extractFirstNumber(nested, keys);
    if (found) return found;
  }
  return undefined;
}

function infoFromObject(value: unknown, source: ModelContextSource, endpoint?: string): ModelContextInfo | undefined {
  const context = extractFirstNumber(value, CONTEXT_KEYS) || extractFirstNumber(value, INPUT_KEYS);
  if (!context) return undefined;
  return {
    context,
    input: extractFirstNumber(value, INPUT_KEYS),
    output: extractFirstNumber(value, OUTPUT_KEYS),
    source,
    confidence: source === 'models' ? 'high' : 'medium',
    endpoint,
    updatedAt: Date.now(),
  };
}

export function resolveFromModelsPayload(payload: any, model: string, endpoint?: string): ModelContextInfo | undefined {
  const models = modelListFromPayload(payload);
  if (models.length === 0) return infoFromObject(payload, 'models', endpoint);
  let fallbackSingle: any | undefined;
  if (models.length === 1) fallbackSingle = models[0];
  for (const candidate of models) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const ids = [record.id, record.model, record.name, record.slug, record.key, record.canonical_slug].filter((id): id is string => typeof id === 'string');
    if (ids.some((id) => modelMatches(id, model))) return infoFromObject(candidate, 'models', endpoint);
  }
  return fallbackSingle ? infoFromObject(fallbackSingle, 'models', endpoint) : undefined;
}

export interface ModelContextResolveOptions {
  preferFreshModels?: boolean;
  timeoutMs?: number;
}

async function resolveFreshModelsContext(
  config: AurixConfig,
  timeoutMs = METADATA_TIMEOUT_MS
): Promise<ModelContextInfo | undefined> {
  for (const endpoint of modelEndpointCandidates(config)) {
    const info = resolveFromModelsPayload(
      await fetchModelPayload(endpoint, config, timeoutMs),
      config.model,
      endpoint.url
    );
    if (!info) continue;
    saveCachedModelContextInfo(config, info);
    return info;
  }
  return undefined;
}

export async function resolveModelContextInfo(
  config: AurixConfig,
  options: ModelContextResolveOptions = {}
): Promise<ModelContextInfo> {
  if (isAurixFreeModel(config.model)) {
    return {
      context: AURIX_FREE_CONTEXT_LIMIT,
      input: AURIX_FREE_CONTEXT_LIMIT,
      source: 'catalog',
      confidence: 'high',
      updatedAt: Date.now(),
    };
  }
  if (options.preferFreshModels) {
    const fresh = await resolveFreshModelsContext(config, options.timeoutMs);
    if (fresh) return fresh;
  }

  const cached = getCachedModelContextInfo(config);
  if (cached) return cached;

  if (!options.preferFreshModels) {
    const fresh = await resolveFreshModelsContext(config, options.timeoutMs);
    if (fresh) return fresh;
  }

  const registry = registryModelLimits(config.model);
  if (registry)
    return {
      context: registry.input,
      input: registry.input,
      output: registry.output,
      source: 'registry',
      confidence: 'medium',
      updatedAt: Date.now(),
    };
  const explicit = configInfo(config);
  if (explicit) return explicit;
  const catalog = familyCatalogContext(config.model);
  if (catalog) return { context: catalog, source: 'catalog', confidence: 'medium', updatedAt: Date.now() };
  const marker = parseContextMarker(config.model);
  if (marker) return { context: marker, source: 'marker', confidence: 'medium', updatedAt: Date.now() };
  return { context: FALLBACK_CONTEXT_LIMIT, source: 'fallback', confidence: 'low', updatedAt: Date.now() };
}

export async function resolveModelContextLimit(
  config: AurixConfig,
  options: ModelContextResolveOptions = {}
): Promise<number> {
  return (await resolveModelContextInfo(config, options)).context;
}

export function modelContextDiagnostic(info: ModelContextInfo): string {
  const parts = [`context=${info.context}`, `source=${info.source}`, `confidence=${info.confidence}`];
  if (info.input) parts.push(`input=${info.input}`);
  if (info.output) parts.push(`output=${info.output}`);
  if (info.endpoint) parts.push(`endpoint=${info.endpoint}`);
  return parts.join(' ');
}
