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

export type ModelContextSource = 'config' | 'env' | 'cache' | 'models' | 'marker' | 'catalog' | 'fallback';

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
  return parseContextMarker(model) || familyCatalogContext(model) || FALLBACK_CONTEXT_LIMIT;
}

function familyCatalogContext(model: string): number | undefined {
  const lower = model.toLowerCase();
  if (lower.includes('claude-3-7') || lower.includes('claude-3.7') || lower.includes('claude-sonnet-4')) return 200_000;
  if (lower.includes('gemini-1.5') || lower.includes('gemini-2')) return 1_000_000;
  if (lower.includes('gpt-4.1') || lower.includes('gpt-4o')) return 128_000;
  return undefined;
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
  const explicit = configInfo(config);
  if (explicit) return explicit;

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

  const marker = parseContextMarker(config.model);
  if (marker) return { context: marker, source: 'marker', confidence: 'medium', updatedAt: Date.now() };
  const catalog = familyCatalogContext(config.model);
  if (catalog) return { context: catalog, source: 'catalog', confidence: 'low', updatedAt: Date.now() };
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
