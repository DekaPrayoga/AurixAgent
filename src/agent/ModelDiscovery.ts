import type { AurixConfig } from './Config.js';
import { anthropicBaseUrl, openAIBaseUrl } from '../utils/base-url.js';
import { mergeAurixFreeModel } from './AurixFreeModel.js';

export type ModelEndpointStyle = 'openai' | 'anthropic';

export interface ModelEndpointCandidate {
  base: string;
  style: ModelEndpointStyle;
  url: string;
}

export interface DiscoveredModel {
  id: string;
  label: string;
  provider?: string;
  description?: string;
  created?: number | string;
  raw?: unknown;
}

export interface ModelFetchAttempt {
  url: string;
  style: ModelEndpointStyle;
  ok: boolean;
  status?: number;
  error?: string;
  count?: number;
}

export interface ModelDiscoveryResult {
  models: DiscoveredModel[];
  attempts: ModelFetchAttempt[];
  sourceUrl?: string;
  style?: ModelEndpointStyle;
}

const MODEL_ID_KEYS = ['id', 'model', 'name', 'slug', 'key', 'canonical_slug'] as const;

function normalizeBase(rawBase: string): string {
  return rawBase
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/messages\/?$/i, '')
    .replace(/\/$/, '');
}

function addVariants(
  out: ModelEndpointCandidate[],
  rawBase: string,
  style: ModelEndpointStyle
): void {
  const base = normalizeBase(rawBase);
  const variants = new Set<string>([base]);
  if (base.endsWith('/v1')) variants.add(base.slice(0, -3));
  else variants.add(`${base}/v1`);
  for (const variant of variants) {
    out.push({ base: variant, style, url: `${variant}/models` });
  }
}

export function modelEndpointCandidates(config: AurixConfig): ModelEndpointCandidate[] {
  const out: ModelEndpointCandidate[] = [];
  if (config.provider === 'anthropic' || config.provider === 'custom-anthropic' || config.apiStyle === 'anthropic') {
    addVariants(out, anthropicBaseUrl(config.baseUrl), 'anthropic');
  } else if (config.apiStyle === 'auto') {
    addVariants(out, openAIBaseUrl(config.baseUrl), 'openai');
    addVariants(out, anthropicBaseUrl(config.baseUrl), 'anthropic');
  } else {
    addVariants(out, openAIBaseUrl(config.baseUrl), 'openai');
  }
  const seen = new Set<string>();
  return out.filter((candidate) => {
    const key = `${candidate.style}:${candidate.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function modelListFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const value = payload as Record<string, unknown>;
  for (const key of ['data', 'models', 'items']) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
  }
  return [];
}

function firstString(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    if (typeof value[key] === 'string' && String(value[key]).trim()) return String(value[key]).trim();
  }
  return undefined;
}

export function extractModelsFromPayload(payload: unknown): DiscoveredModel[] {
  const found: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of modelListFromPayload(payload)) {
    const object = typeof entry === 'string' ? { id: entry } : entry;
    if (!object || typeof object !== 'object') continue;
    const value = object as Record<string, unknown>;
    const id = firstString(value, MODEL_ID_KEYS);
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const provider = firstString(value, ['owned_by', 'provider', 'owner', 'organization']);
    found.push({
      id,
      label: name && name.toLowerCase() !== id.toLowerCase() ? name : id,
      provider,
      description: firstString(value, ['description', 'summary']),
      created: typeof value.created === 'number' || typeof value.created === 'string' ? value.created : undefined,
      raw: entry,
    });
  }
  return found;
}

function bypassProxyIfLocal(url: string): void {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {}
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return;
  const parts = (process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const local of ['127.0.0.1', 'localhost', '::1']) {
    if (!parts.includes(local)) parts.push(local);
  }
  process.env.NO_PROXY = parts.join(',');
  process.env.no_proxy = process.env.NO_PROXY;
}

function headersFor(candidate: ModelEndpointCandidate, config: AurixConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (!config.apiKey) return headers;
  if (candidate.style === 'anthropic') {
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

function nextPageUrl(
  payload: unknown,
  currentUrl: string,
  models: DiscoveredModel[],
  style: ModelEndpointStyle
): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = payload as Record<string, unknown>;
  for (const key of ['next', 'next_url', 'nextPage', 'next_page']) {
    if (typeof value[key] === 'string' && value[key]) {
      try {
        return new URL(value[key] as string, currentUrl).toString();
      } catch {}
    }
  }
  if (value.has_more === true) {
    const cursor = firstString(value, ['last_id', 'after_id', 'after', 'cursor']) || models[models.length - 1]?.id;
    if (cursor) {
      const url = new URL(currentUrl);
      url.searchParams.set(style === 'anthropic' ? 'after_id' : 'after', cursor);
      return url.toString();
    }
  }
  return undefined;
}

function errorLabel(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'Request timed out';
  if (error instanceof Error) return error.message;
  return String(error || 'Request failed');
}

export async function fetchConfiguredModels(
  config: AurixConfig,
  options: { timeoutMs?: number; maxPages?: number; maxModels?: number } = {}
): Promise<ModelDiscoveryResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxPages = options.maxPages ?? 20;
  const maxModels = options.maxModels ?? 2000;
  const attempts: ModelFetchAttempt[] = [];

  for (const candidate of modelEndpointCandidates(config)) {
    const collected: DiscoveredModel[] = [];
    const seen = new Set<string>();
    let url: string | undefined = candidate.url;
    let page = 0;

    while (url && page < maxPages && collected.length < maxModels) {
      page++;
      const requestUrl = url;
      bypassProxyIfLocal(requestUrl);
      const request: RequestInit = {
        headers: headersFor(candidate, config),
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (/^https:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i.test(url)) {
        try {
          const { Agent } = await import('undici');
          (request as any).dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
        } catch {}
      }
      try {
        const response = await fetch(requestUrl, request as any);
        if (!response.ok) {
          let snippet = '';
          try {
            snippet = (await response.text()).replace(/\s+/g, ' ').slice(0, 180);
          } catch {}
          attempts.push({
            url: requestUrl,
            style: candidate.style,
            ok: false,
            status: response.status,
            error: snippet || response.statusText || `HTTP ${response.status}`,
          });
          break;
        }
        const payload = await response.json();
        const pageModels = extractModelsFromPayload(payload);
        for (const model of pageModels) {
          const key = model.id.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          collected.push(model);
          if (collected.length >= maxModels) break;
        }
        attempts.push({ url, style: candidate.style, ok: true, status: response.status, count: pageModels.length });
        const nextUrl = nextPageUrl(payload, requestUrl, pageModels, candidate.style);
        if (nextUrl && new URL(nextUrl).origin !== new URL(candidate.url).origin) {
          attempts.push({
            url: nextUrl,
            style: candidate.style,
            ok: false,
            error: 'Rejected cross-origin pagination URL',
          });
          break;
        }
        url = nextUrl;
      } catch (error) {
        attempts.push({ url: requestUrl, style: candidate.style, ok: false, error: errorLabel(error) });
        break;
      }
    }

    if (collected.length > 0) {
      return {
        models: mergeAurixFreeModel(collected),
        attempts,
        sourceUrl: candidate.url,
        style: candidate.style,
      };
    }
  }

  return { models: mergeAurixFreeModel([]), attempts };
}

export async function fetchModelPayload(
  candidate: ModelEndpointCandidate,
  config: AurixConfig,
  timeoutMs = 3000
): Promise<unknown | undefined> {
  bypassProxyIfLocal(candidate.url);
  const request: RequestInit = {
    headers: headersFor(candidate, config),
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i.test(candidate.url)) {
    try {
      const { Agent } = await import('undici');
      (request as any).dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    } catch {}
  }
  try {
    const response = await fetch(candidate.url, request as any);
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}
