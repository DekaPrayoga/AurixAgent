import { type Page } from 'playwright-core';
import { humanClick, humanMove } from './common.js';
import { externalCaptchaConfigured, solveWithExternalCaptchaSolver } from './ExternalCaptchaSolver.js';

function ok(msg: string): string {
  return `[OK] ${msg}`;
}

function warn(msg: string): string {
  return `[WARN] ${msg}`;
}

function err(msg: string, suggestion?: string): string {
  return `[ERROR] ${msg}${suggestion ? `\n  fix: ${suggestion}` : ''}`;
}

export async function detectTurnstile(page: Page): Promise<boolean> {
  try {
    if (page.frames().some((frame) => frame.url().includes('challenges.cloudflare.com'))) return true;
    return await page.evaluate(() => Boolean(
      document.querySelector(
        '.cf-turnstile, iframe[src*="challenges.cloudflare.com"], input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], script[src*="challenges.cloudflare.com/turnstile"]'
      )
    ));
  } catch {
    return false;
  }
}

export async function extractTurnstileDetails(page: Page): Promise<{
  websiteKey?: string;
  action?: string;
  cdata?: string;
  callbackName?: string;
  callbackCaptured?: boolean;
}> {
  const details = await page.evaluate(() => {
    const widget = document.querySelector(
      '.cf-turnstile[data-sitekey], [data-sitekey][data-callback*="turnstile" i], [data-sitekey][data-action][data-cdata]'
    ) as HTMLElement | null;
    const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]') as HTMLIFrameElement | null;
    let frameKey = '';
    try {
      const url = iframe?.src ? new URL(iframe.src) : undefined;
      frameKey = url?.searchParams.get('sitekey') || url?.searchParams.get('k') || '';
      if (!frameKey) {
        const match = url?.pathname.match(/\/turnstile\/[^/]+\/[^/]+\/([^/]+)/);
        frameKey = match?.[1] || '';
      }
    } catch {}
    const captured = (window as any).__aurixTurnstile || {};
    return {
      websiteKey: widget?.getAttribute('data-sitekey') || frameKey || captured.websiteKey,
      action: widget?.getAttribute('data-action') || captured.action || undefined,
      cdata: widget?.getAttribute('data-cdata') || captured.cdata || undefined,
      callbackName: widget?.getAttribute('data-callback') || undefined,
      callbackCaptured: typeof captured.callback === 'function',
    };
  });
  if (details.websiteKey) return details;
  for (const frame of page.frames()) {
    try {
      const url = new URL(frame.url());
      if (!url.hostname.includes('challenges.cloudflare.com')) continue;
      const key = url.searchParams.get('sitekey') || url.searchParams.get('k');
      if (key) return { ...details, websiteKey: key };
    } catch {}
  }
  return details;
}

export async function hasTurnstileToken(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const fields = Array.from(
        document.querySelectorAll(
          'textarea[name="cf-turnstile-response"], input[name="cf-turnstile-response"]'
        )
      ) as Array<HTMLTextAreaElement | HTMLInputElement>;
      return fields.some((field) => field.value.trim().length > 0);
    });
  } catch {
    return false;
  }
}

export async function injectTurnstileToken(page: Page, token: string): Promise<{
  wrote: boolean;
  callbackInvoked: boolean;
}> {
  const details = await extractTurnstileDetails(page);
  try {
    return await page.evaluate(({ value, callbackName }) => {
      let wrote = false;
      const names = ['cf-turnstile-response', 'g-recaptcha-response'];
      for (const name of names) {
        const elements = Array.from(document.querySelectorAll(
          `textarea[name="${name}"], input[name="${name}"]`
        )) as Array<HTMLTextAreaElement | HTMLInputElement>;
        for (const element of elements) {
          element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          wrote = true;
        }
      }
      const callback = String(callbackName || '')
        .split('.')
        .filter(Boolean)
        .reduce<unknown>((current, part) =>
          current && (typeof current === 'object' || typeof current === 'function')
            ? (current as Record<string, unknown>)[part]
            : undefined, window as unknown);
      let callbackInvoked = false;
      if (typeof callback === 'function') {
        try {
          (callback as (response: string) => void)(value);
          callbackInvoked = true;
        } catch {}
      }
      const capturedCallback = (window as any).__aurixTurnstile?.callback;
      if (!callbackInvoked && typeof capturedCallback === 'function') {
        try {
          capturedCallback(value);
          callbackInvoked = true;
        } catch {}
      }
      return { wrote, callbackInvoked };
    }, { value: token, callbackName: details.callbackName });
  } catch {
    return { wrote: false, callbackInvoked: false };
  }
}

async function clickTurnstileNatively(page: Page): Promise<boolean> {
  const frames = page.frames().filter((candidate) => candidate.url().includes('challenges.cloudflare.com'));
  for (const frame of frames) {
    const checkbox = frame.locator('input[type="checkbox"], .cb-lb, #challenge-stage label');
    if ((await checkbox.count().catch(() => 0)) > 0) {
      await humanClick(checkbox.first(), page);
      return true;
    }
  }
  for (const frame of frames) {
    const frameElement = await frame.frameElement().catch(() => null);
    const box = frameElement ? await frameElement.boundingBox().catch(() => null) : null;
    if (!box || box.width < 20 || box.height < 20) continue;
    const x = box.x + Math.min(30, Math.max(16, box.width * 0.08));
    const y = box.y + box.height / 2;
    await humanMove(x, y, page);
    await page.mouse.click(x, y, { delay: 80 + Math.floor(Math.random() * 90) });
    return true;
  }
  const iframes = page.locator('iframe[src*="challenges.cloudflare.com"]');
  const count = await iframes.count().catch(() => 0);
  for (let index = 0; index < count; index++) {
    const box = await iframes.nth(index).boundingBox().catch(() => null);
    if (!box || box.width < 20 || box.height < 20) continue;
    const x = box.x + Math.min(30, Math.max(16, box.width * 0.08));
    const y = box.y + box.height / 2;
    await humanMove(x, y, page);
    await page.mouse.click(x, y, { delay: 80 + Math.floor(Math.random() * 90) });
    return true;
  }
  return false;
}

async function turnstileResolved(page: Page, startUrl: string): Promise<boolean> {
  if (await hasTurnstileToken(page)) return true;
  if (page.url() !== startUrl) return true;
  return !(await detectTurnstile(page));
}

async function solveTurnstileWithExternal(page: Page): Promise<string | undefined> {
  if (!externalCaptchaConfigured()) return undefined;
  const details = await extractTurnstileDetails(page);
  if (!details.websiteKey) return warn('External Turnstile solver skipped because the site key could not be extracted');
  const startUrl = page.url();
  const result = await solveWithExternalCaptchaSolver({
    type: 'turnstile',
    sitekey: details.websiteKey,
    url: startUrl,
    action: details.action,
  });
  if (!result.solved) {
    return warn(`External Turnstile solver did not solve${result.error ? `: ${result.error}` : ''}`);
  }
  if (!result.token) return warn(`External Turnstile solver reported success without a token (${result.method || 'sidecar'})`);
  const injected = await injectTurnstileToken(page, result.token);
  await page.waitForTimeout(1200);
  if ((injected.callbackInvoked || page.url() !== startUrl) && await turnstileResolved(page, startUrl)) {
    return ok(`External Turnstile solver verified (${result.method || 'sidecar'})`);
  }
  return warn(`External Turnstile token was injected but page verification did not progress (${result.method || 'sidecar'})`);
}

export async function solveTurnstile(page: Page): Promise<string> {
  const results: string[] = ['Attempting Cloudflare Turnstile natively...'];
  const startUrl = page.url();
  try {
    if (await hasTurnstileToken(page)) return [...results, ok('Cloudflare Turnstile response token already present')].join('\n');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) results.push(`Turnstile native retry ${attempt}/2...`);
      const clicked = await clickTurnstileNatively(page);
      if (!clicked) {
        results.push(warn('Turnstile iframe bounds were unavailable'));
        break;
      }
      await page.waitForTimeout(2500 + Math.random() * 1200);
      if (await turnstileResolved(page, startUrl)) {
        return [...results, ok('Cloudflare Turnstile verified by native browser interaction')].join('\n');
      }
    }
    const external = await solveTurnstileWithExternal(page);
    if (external) results.push(external);
    if (!external?.startsWith('[OK]')) {
      results.push(warn('Native Turnstile solving exhausted; configured API fallback may run next'));
    }
  } catch (error: any) {
    results.push(err(`Turnstile error: ${error.message}`, 'Retry solve-captcha once on the current page'));
  }
  return results.join('\n');
}
