import type { AurixConfig } from '../agent/Config.js';

type ApiStyle = NonNullable<AurixConfig['apiStyle']>;

const VERSION_SEGMENT = 'v1';

export function normalizeBaseUrl(raw?: string, apiStyle: ApiStyle = 'auto'): string | undefined {
  if (!raw) return undefined;

  let value = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!value) return undefined;

  if (!hasScheme(value)) {
    value = `${prefersHttp(value) ? 'http' : 'https'}://${value}`;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Base URL tidak valid: "${raw}". Contoh benar: https://api.openai.com/v1`);
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';

  if (apiStyle === 'openai' && !hasVersionPath(url)) {
    url.pathname = joinPath(url.pathname, VERSION_SEGMENT);
  }

  return url.toString().replace(/\/+$/, '');
}

export function openAIBaseUrl(raw?: string): string {
  return normalizeBaseUrl(raw || 'https://api.openai.com/v1', 'openai')!;
}

export function anthropicBaseUrl(raw?: string): string {
  return normalizeBaseUrl(raw || 'https://api.anthropic.com', 'anthropic')!;
}

export function openAIEndpoint(rawBaseUrl: string | undefined, endpoint: string): string {
  return joinUrl(openAIBaseUrl(rawBaseUrl), endpoint);
}

export function anthropicMessagesEndpoint(rawBaseUrl: string | undefined): string {
  const base = anthropicBaseUrl(rawBaseUrl);
  const parsed = new URL(base);
  const endpoint = hasVersionPath(parsed) ? 'messages' : `${VERSION_SEGMENT}/messages`;
  return joinUrl(base, endpoint);
}

function hasScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value);
}

function prefersHttp(value: string): boolean {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(value);
}

function hasVersionPath(url: URL): boolean {
  return url.pathname.split('/').filter(Boolean).includes(VERSION_SEGMENT);
}

function joinPath(left: string, right: string): string {
  const a = left.replace(/\/+$/, '');
  const b = right.replace(/^\/+/, '');
  return `${a}/${b}`;
}

function joinUrl(base: string, endpoint: string): string {
  return `${base.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
}

