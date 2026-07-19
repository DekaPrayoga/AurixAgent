import { type Page } from 'playwright-core';
import { humanClick } from './common.js';
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

async function extractTurnstileSitekey(page: Page): Promise<string | undefined> {
  try {
    const sitekey = await page.evaluate(() => {
      const selectors = [
        '.cf-turnstile[data-sitekey]',
        'iframe[src*="challenges.cloudflare.com"]',
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector) as HTMLElement | HTMLIFrameElement | null;
        const direct = el?.getAttribute?.('data-sitekey');
        if (direct) return direct;
        const src = (el as HTMLIFrameElement | null)?.src || '';
        const match = src.match(/[?&]sitekey=([^&]+)/i);
        if (match) return decodeURIComponent(match[1]);
      }
      return '';
    });
    return sitekey || undefined;
  } catch {
    return undefined;
  }
}

async function hasTurnstileToken(page: Page): Promise<boolean> {
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

async function injectTurnstileToken(page: Page, token: string): Promise<boolean> {
  try {
    return await page.evaluate((value) => {
      const names = ['cf-turnstile-response', 'g-recaptcha-response'];
      let wrote = false;
      for (const name of names) {
        const elements = Array.from(document.querySelectorAll(`textarea[name="${name}"], input[name="${name}"]`)) as Array<
          HTMLTextAreaElement | HTMLInputElement
        >;
        for (const el of elements) {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          wrote = true;
        }
      }
      const callbacks = ['onTurnstileSuccess', 'turnstileCallback', 'cfCallback'];
      for (const key of callbacks) {
        const fn = (window as any)[key];
        if (typeof fn === 'function') {
          try {
            fn(value);
            wrote = true;
          } catch {}
        }
      }
      return wrote;
    }, token);
  } catch {
    return false;
  }
}

async function solveTurnstileWithExternal(page: Page): Promise<string | undefined> {
  if (!externalCaptchaConfigured()) return undefined;
  const sitekey = await extractTurnstileSitekey(page);
  const result = await solveWithExternalCaptchaSolver({
    type: 'turnstile',
    sitekey,
    url: page.url(),
  });
  if (!result.solved) {
    return warn(`External Turnstile solver did not solve${result.error ? `: ${result.error}` : ''}`);
  }
  if (result.token) {
    const injected = await injectTurnstileToken(page, result.token);
    if (injected) {
      return ok(`External Turnstile solver returned token (${result.method || 'sidecar'}, injected)`);
    }
    return warn(
      `External Turnstile solver returned token but no response field/callback accepted it (${result.method || 'sidecar'})`
    );
  }
  return warn(`External Turnstile solver reported success without a token (${result.method || 'sidecar'})`);
}

export async function solveTurnstile(page: Page): Promise<string> {
  const results: string[] = ['Attempting Cloudflare Turnstile...'];
  try {
    const external = await solveTurnstileWithExternal(page);
    if (external?.startsWith('[OK]')) return [...results, external].join('\n');
    if (external) results.push(external);

    const maxRetries = 3;
    let resolved = false;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) results.push(`Turnstile retry ${attempt}/${maxRetries}...`);
      const tFrame = page.frames().find((f) => f.url().includes('challenges.cloudflare'));
      if (tFrame) {
        await page.waitForTimeout(1000 + Math.random() * 1000);
        const cb = tFrame.locator('input[type="checkbox"], .cb-lb, #challenge-stage label');
        if ((await cb.count()) > 0) await humanClick(cb, page);
        else await tFrame.locator('body').click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(4000);
      }
      const content = await page.content();
      const tokenPresent = await hasTurnstileToken(page);
      if (
        tokenPresent ||
        (!content.includes('cf-turnstile') && !content.includes('challenges.cloudflare'))
      ) {
        resolved = true;
        results.push(
          ok(
            tokenPresent
              ? 'Cloudflare Turnstile verified — response token present'
              : 'Cloudflare Turnstile bypassed — page unlocked'
          )
        );
        break;
      }
      if (attempt < maxRetries - 1) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
    }
    if (!resolved) results.push(warn('Turnstile still active after retries — try switching proxy or waiting'));
  } catch (e: any) {
    results.push(err(`Turnstile error: ${e.message}`, 'Try reloading the page or switching proxy'));
  }
  return results.join('\n');
}
