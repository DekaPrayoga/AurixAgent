import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Page } from 'playwright-core';

export const A11Y_STATE_PATH = join(homedir(), '.aurix', 'hcaptcha-a11y.json');
export const A11Y_COOKIE_NAME = 'hc_accessibility';
export const A11Y_DOMAIN = '.hcaptcha.com';
/** Renew / re-ask user when less than this many seconds remain */
export const A11Y_MIN_TTL_SECONDS = 600;
/** Default max-age from hCaptcha Set-Cookie */
export const A11Y_DEFAULT_MAX_AGE = 43200;

export type HcaptchaA11yCookie = {
  value: string;
  setAt: number;
  maxAge: number;
  expiresAt: number;
  domain?: string;
  path?: string;
  secure?: boolean;
  sameSite?: 'None' | 'Lax' | 'Strict';
};

export type HcaptchaA11yState = {
  hc_accessibility?: HcaptchaA11yCookie | null;
  hmt_id?: string;
  loginMethod?: string;
  updatedAt?: string;
  source?: string;
  [key: string]: unknown;
};

function ensureDir(): void {
  const dir = join(homedir(), '.aurix');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadA11yState(): HcaptchaA11yState {
  try {
    if (!existsSync(A11Y_STATE_PATH)) return {};
    return JSON.parse(readFileSync(A11Y_STATE_PATH, 'utf8')) as HcaptchaA11yState;
  } catch {
    return {};
  }
}

export function saveA11yState(state: HcaptchaA11yState): void {
  ensureDir();
  const next = { ...loadA11yState(), ...state, updatedAt: new Date().toISOString() };
  writeFileSync(A11Y_STATE_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function getA11yCookie(): HcaptchaA11yCookie | null {
  const hc = loadA11yState().hc_accessibility;
  if (!hc?.value) return null;
  return hc;
}

export function a11yTtlSeconds(hc?: HcaptchaA11yCookie | null): number {
  if (!hc?.expiresAt) return -1;
  return Math.floor(hc.expiresAt - Date.now() / 1000);
}

export function isA11yCookieValid(minTtl = A11Y_MIN_TTL_SECONDS): boolean {
  const hc = getA11yCookie();
  if (!hc?.value) return false;
  return a11yTtlSeconds(hc) > minTtl;
}

/** Agent should ask user for a fresh cookie when this returns true. */
export function needsA11yCookieFromUser(): boolean {
  return !isA11yCookieValid();
}

export function setA11yCookieFromUser(
  value: string,
  opts?: { maxAge?: number; expiresAt?: number; source?: string }
): HcaptchaA11yCookie {
  const cleaned = value.trim().replace(/^hc_accessibility=/i, '');
  if (!cleaned || cleaned.length < 40) {
    throw new Error('hc_accessibility value too short / empty');
  }
  const now = Math.floor(Date.now() / 1000);
  const maxAge = opts?.maxAge ?? A11Y_DEFAULT_MAX_AGE;
  const expiresAt = opts?.expiresAt ?? now + maxAge;
  const hc: HcaptchaA11yCookie = {
    value: cleaned,
    setAt: now,
    maxAge,
    expiresAt,
    domain: A11Y_DOMAIN,
    path: '/',
    secure: true,
    sameSite: 'None',
  };
  saveA11yState({
    hc_accessibility: hc,
    source: opts?.source || 'agent_user_provide',
  });
  return hc;
}

export function playwrightCookiePayload(hc?: HcaptchaA11yCookie | null): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  sameSite: 'None' | 'Lax' | 'Strict';
  expires: number;
}> {
  const cookie = hc || getA11yCookie();
  if (!cookie?.value) return [];
  const expires =
    cookie.expiresAt || Math.floor(Date.now() / 1000) + (cookie.maxAge || A11Y_DEFAULT_MAX_AGE);
  return [
    {
      name: A11Y_COOKIE_NAME,
      value: cookie.value,
      domain: cookie.domain || A11Y_DOMAIN,
      path: cookie.path || '/',
      secure: cookie.secure !== false,
      sameSite: (cookie.sameSite as 'None') || 'None',
      expires,
    },
  ];
}

/**
 * Inject hc_accessibility into the Playwright browser context (profile jar).
 * Call before navigating to a page with hCaptcha, or right before solve.
 */
export async function injectA11yCookie(context: {
  addCookies: (cookies: any[]) => Promise<void>;
}): Promise<{ injected: boolean; reason: string; ttl?: number }> {
  const hc = getA11yCookie();
  if (!hc?.value) {
    return {
      injected: false,
      reason:
        'no hc_accessibility in ~/.aurix/hcaptcha-a11y.json — ask user to paste cookie value',
    };
  }
  const ttl = a11yTtlSeconds(hc);
  if (ttl <= 0) {
    return {
      injected: false,
      reason: `hc_accessibility expired ${Math.abs(ttl)}s ago — ask user for a fresh cookie`,
      ttl,
    };
  }
  const payload = playwrightCookiePayload(hc);
  await context.addCookies(payload);
  return {
    injected: true,
    reason: `injected hc_accessibility (ttl≈${Math.floor(ttl / 3600)}h ${ttl % 3600}s left)`,
    ttl,
  };
}

export function agentPromptForA11yCookie(): string {
  return [
    '[NEED] hc_accessibility cookie for hCaptcha accessibility pass.',
    'Ask the user to paste the value of cookie `hc_accessibility` from a browser that has accessibility access.',
    'How (Firefox/Chrome DevTools):',
    '  1. Open dashboard.hcaptcha.com (logged into accessibility account)',
    '  2. DevTools → Storage/Application → Cookies → .hcaptcha.com',
    '  3. Copy value of `hc_accessibility` (not the name)',
    '  4. Reply with only the cookie value (or: hc_accessibility=<value>)',
    `Cookie lasts ~12h (max-age ${A11Y_DEFAULT_MAX_AGE}). Challenge appearing again = expired → re-request.`,
  ].join('\n');
}

/**
 * After checkbox click: if challenge frame still present, a11y cookie is dead/weak.
 */
export async function detectChallengeAfterClick(page: Page): Promise<boolean> {
  try {
    const frames = page.frames();
    return frames.some((f) => {
      const u = f.url();
      return /hcaptcha/i.test(u) && /challenge|bframe/i.test(u);
    });
  } catch {
    return false;
  }
}
