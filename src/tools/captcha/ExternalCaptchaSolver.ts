import { loadConfig } from '../../agent/Config.js';

type ExternalCaptchaType = 'turnstile' | 'hcaptcha';

export type ExternalCaptchaRequest = {
  type: ExternalCaptchaType;
  sitekey?: string;
  url: string;
  action?: string;
  invisible?: boolean;
};

export type ExternalCaptchaResult = {
  solved: boolean;
  token?: string;
  method?: string;
  elapsed?: number;
  error?: string;
  raw?: Record<string, unknown>;
};

export function externalCaptchaConfigured(): boolean {
  const config = loadConfig();
  return Boolean(process.env.AURIX_CAPTCHA_SOLVER_URL || config.captchaSolver?.url);
}

export function resolveExternalSolverConfig(captchaSolver?: {
  url?: string;
  token?: string;
  timeoutSeconds?: number;
}) {
  const timeoutSeconds = captchaSolver?.timeoutSeconds ?? 90;
  return {
    url: (process.env.AURIX_CAPTCHA_SOLVER_URL || captchaSolver?.url || '').replace(/\/+$/, ''),
    token: process.env.AURIX_CAPTCHA_SOLVER_TOKEN || captchaSolver?.token || '',
    timeoutMs: Math.max(5_000, Math.min(180_000, timeoutSeconds * 1000)),
  };
}

function solverConfig() {
  return resolveExternalSolverConfig(loadConfig().captchaSolver);
}

export function buildExternalSolverBody(
  args: ExternalCaptchaRequest,
  timeoutMs: number
): Record<string, unknown> {
  return {
    type: args.type,
    sitekey: args.sitekey,
    url: args.url,
    timeout_s: Math.ceil(timeoutMs / 1000),
    ...(args.action ? { action: args.action } : {}),
    ...(args.invisible ? { invisible: true } : {}),
  };
}

export async function solveWithExternalCaptchaSolver(
  args: ExternalCaptchaRequest
): Promise<ExternalCaptchaResult> {
  const cfg = solverConfig();
  if (!cfg.url) return { solved: false, error: 'AURIX_CAPTCHA_SOLVER_URL is not configured' };
  if (!/^https?:\/\//i.test(cfg.url)) return { solved: false, error: 'captcha solver URL must be http(s)' };
  if (!args.url || !/^https?:\/\//i.test(args.url)) {
    return { solved: false, error: 'current page URL is not an http(s) URL' };
  }

  const body = buildExternalSolverBody(args, cfg.timeoutMs);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch(`${cfg.url}/solve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!response.ok) {
      const detail = json?.detail || json?.error || text || `HTTP ${response.status}`;
      return { solved: false, error: String(detail).slice(0, 300), raw: json };
    }
    const token = String(json?.token || json?.response || json?.captcha_response || '').trim();
    const solved = Boolean(json?.solved || token || json?.success || json?.verify_success);
    return {
      solved,
      token: token || undefined,
      method: json?.method ? String(json.method) : undefined,
      elapsed: typeof json?.elapsed === 'number' ? json.elapsed : undefined,
      error: json?.error ? String(json.error).slice(0, 300) : undefined,
      raw: json,
    };
  } catch (error: any) {
    return { solved: false, error: String(error?.message || error).slice(0, 300) };
  } finally {
    clearTimeout(timeout);
  }
}
