import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AurixConfig } from './Config.js';
import { anthropicBaseUrl, openAIBaseUrl } from '../utils/base-url.js';

const CACHE_TTL_MS = 60 * 60 * 1000;
const FALLBACK_CONTEXT_LIMIT = 256_000; // optimistic default for custom/local providers when metadata is unavailable
const METADATA_TIMEOUT_MS = 3000;
const CONTEXT_KEYS = [
  'context_length',
  'context_window',
  'max_context_length',
  'max_model_len',
  'max_input_tokens',
  'input_token_limit',
  'max_sequence_length',
];

interface ContextCacheEntry {
  contextLength: number;
  updatedAt: number;
}

function cachePath(): string {
  return path.join(os.homedir(), '.aurix', 'state', 'model-context-cache.json');
}

function cacheKey(config: AurixConfig): string {
  return `${config.model}@${config.baseUrl || config.provider || 'default'}`;
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

export function getCachedModelContextLimit(config: AurixConfig): number | undefined {
  const entry = readCache()[cacheKey(config)];
  if (!entry || !Number.isFinite(entry.contextLength) || entry.contextLength <= 0) return undefined;
  if (Date.now() - entry.updatedAt > CACHE_TTL_MS) return undefined;
  return entry.contextLength;
}

export function saveCachedModelContextLimit(config: AurixConfig, contextLength: number): void {
  if (!Number.isFinite(contextLength) || contextLength <= 0) return;
  const cache = readCache();
  cache[cacheKey(config)] = { contextLength: Math.round(contextLength), updatedAt: Date.now() };
  writeCache(cache);
}

export function parseProviderContextLimitFromError(error: unknown): number | undefined {
  const text = error instanceof Error ? error.message : String(error || '');
  const patterns = [
    /maximum context length is\s*([\d,]{4,})\s*(?:tokens?|token)?/gi,
    /context(?: length| window)?(?: limit)?(?: is|:)?\s*([\d,]{4,})\s*(?:tokens?|token)/gi,
    /(?:context|prompt)[^\n]{0,80}(?:maximum|limit)[^\d]{0,40}([\d,]{4,})\s*(?:tokens?|token)?/gi,
    /requested\s+[\d,]{4,}\s*(?:tokens?|token)[^\n]{0,100}(?:maximum context|context limit)[^\d]{0,40}([\d,]{4,})/gi,
  ];
  const candidates: number[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const value = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(value) && value >= 4_000 && value <= 2_000_000) candidates.push(value);
    }
  }
  if (candidates.length === 0) return undefined;
  return Math.min(...candidates);
}

export function parseContextMarker(model: string): number | undefined {
  const lower = model.toLowerCase();
  if (/\[(?:1m|1000k|1_000k)\]|\b(?:1m|1000k|1-million|million-context)\b/.test(lower))
    return 1_000_000;
  const match = lower.match(/(?:^|[-_\s/])(\d+(?:\.\d+)?)(k|m)(?:[-_\s/]|$)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(match[2] === 'm' ? value * 1_000_000 : value * 1_000);
}

export function fallbackModelContextLimit(model: string): number {
  return parseContextMarker(model) || FALLBACK_CONTEXT_LIMIT;
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

function extractFirstContextLength(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of CONTEXT_KEYS) {
    const raw = obj[key];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw);
    if (typeof raw === 'string') {
      const parsed = Number(raw.replace(/,/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
    }
  }
  for (const nested of Object.values(obj)) {
    const found = extractFirstContextLength(nested);
    if (found) return found;
  }
  return undefined;
}

function modelListFromPayload(payload: any): any[] {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  if (Array.isArray(payload)) return payload;
  return [];
}

function resolveFromModelsPayload(payload: any, model: string): number | undefined {
  const models = modelListFromPayload(payload);
  if (models.length === 0) return extractFirstContextLength(payload);

  let fallbackSingle: any | undefined;
  if (models.length === 1) fallbackSingle = models[0];

  for (const candidate of models) {
    if (!candidate || typeof candidate !== 'object') continue;
    const ids = [
      candidate.id,
      candidate.model,
      candidate.name,
      candidate.slug,
      candidate.key,
      candidate.canonical_slug,
    ].filter((id): id is string => typeof id === 'string');
    if (ids.some((id) => modelMatches(id, model))) {
      const ctx = extractFirstContextLength(candidate);
      if (ctx) return ctx;
    }
  }

  return fallbackSingle ? extractFirstContextLength(fallbackSingle) : undefined;
}

type MetadataStyle = 'openai' | 'anthropic';
interface MetadataEndpoint {
  base: string;
  style: MetadataStyle;
}

function normalizeMetadataBase(rawBase: string): string {
  return rawBase
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/messages\/?$/, '')
    .replace(/\/$/, '');
}

function addEndpointVariants(out: MetadataEndpoint[], rawBase: string, style: MetadataStyle): void {
  const base = normalizeMetadataBase(rawBase);
  const variants = new Set<string>();
  variants.add(base);
  if (base.endsWith('/v1')) variants.add(base.slice(0, -3));
  else variants.add(`${base}/v1`);
  for (const variant of variants) out.push({ base: variant, style });
}

function endpointCandidates(config: AurixConfig): MetadataEndpoint[] {
  const candidates: MetadataEndpoint[] = [];
  if (config.provider === 'anthropic' || config.apiStyle === 'anthropic') {
    addEndpointVariants(candidates, anthropicBaseUrl(config.baseUrl), 'anthropic');
  } else if (config.apiStyle === 'auto') {
    addEndpointVariants(candidates, openAIBaseUrl(config.baseUrl), 'openai');
    addEndpointVariants(candidates, anthropicBaseUrl(config.baseUrl), 'anthropic');
  } else {
    addEndpointVariants(candidates, openAIBaseUrl(config.baseUrl), 'openai');
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.style}:${candidate.base}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function bypassProxyIfLocal(url: string): void {
  if (!url.includes('localhost') && !url.includes('127.0.0.1')) return;
  const currentNoProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  const parts = currentNoProxy
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const local of ['127.0.0.1', 'localhost']) {
    if (!parts.includes(local)) parts.push(local);
  }
  process.env.NO_PROXY = parts.join(',');
  process.env.no_proxy = process.env.NO_PROXY;
}

async function fetchJson(
  endpoint: MetadataEndpoint,
  config: AurixConfig
): Promise<any | undefined> {
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    if (endpoint.style === 'anthropic') {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }
  }
  const url = `${endpoint.base}/models`;
  bypassProxyIfLocal(url);
  const fetchOpts: RequestInit = { headers, signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) };
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    try {
      const { Agent } = await import('undici');
      (fetchOpts as any).dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    } catch {}
  }
  try {
    const res = await fetch(url, fetchOpts as any);
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function resolveModelContextLimit(config: AurixConfig): Promise<number> {
  const cached = getCachedModelContextLimit(config);
  if (cached) return cached;

  for (const endpoint of endpointCandidates(config)) {
    const payload = await fetchJson(endpoint, config);
    const contextLength = resolveFromModelsPayload(payload, config.model);
    if (contextLength) {
      saveCachedModelContextLimit(config, contextLength);
      return contextLength;
    }
  }

  return fallbackModelContextLimit(config.model);
}
