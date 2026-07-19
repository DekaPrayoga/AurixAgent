import { type Page } from 'playwright-core';
import { humanClick } from './common.js';
import { solveCaptchaGrid } from './RecaptchaSolver.js';
import { externalCaptchaConfigured, solveWithExternalCaptchaSolver } from './ExternalCaptchaSolver.js';
import {
  agentPromptForA11yCookie,
  detectChallengeAfterClick,
  injectA11yCookie,
  isA11yCookieValid,
  needsA11yCookieFromUser,
} from './HcaptchaA11y.js';

function ok(msg: string, details?: Record<string, string>): string {
  const lines = [`[OK] ${msg}`];
  if (details) for (const [k, v] of Object.entries(details)) lines.push(`  ${k}: ${v}`);
  return lines.join('\n');
}

function warn(msg: string, details?: Record<string, string>): string {
  const lines = [`[WARN] ${msg}`];
  if (details) for (const [k, v] of Object.entries(details)) lines.push(`  ${k}: ${v}`);
  return lines.join('\n');
}

function err(msg: string, suggestion?: string): string {
  const lines = [`[ERROR] ${msg}`];
  if (suggestion) lines.push(`  fix: ${suggestion}`);
  return lines.join('\n');
}

export function isHcaptchaChallengeUrl(url: string): boolean {
  return /hcaptcha/i.test(url) && /(?:challenge|bframe)/i.test(url);
}

export function isHcaptchaCheckboxUrl(url: string): boolean {
  return /hcaptcha/i.test(url) && !isHcaptchaChallengeUrl(url) && /(?:checkbox|api2\/anchor|newassets\.hcaptcha)/i.test(url);
}

export function classifyHcaptchaFrames<T extends { url(): string }>(frames: T[]): {
  checkbox?: T;
  challenge?: T;
  detected: boolean;
} {
  const checkbox = frames.find((frame) => isHcaptchaCheckboxUrl(frame.url()));
  const challenge = frames.find((frame) => isHcaptchaChallengeUrl(frame.url()));
  return { checkbox, challenge, detected: Boolean(checkbox || challenge) };
}

async function extractHcaptchaSitekey(page: Page): Promise<string | undefined> {
  try {
    const sitekey = await page.evaluate(() => {
      const selectors = ['.h-captcha[data-sitekey]', 'iframe[src*="hcaptcha.com"]'];
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

async function injectHcaptchaToken(page: Page, token: string): Promise<boolean> {
  try {
    return await page.evaluate((value) => {
      const names = ['h-captcha-response', 'g-recaptcha-response'];
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
      const fn = (window as any).hcaptchaCallback || (window as any).onHcaptchaSuccess;
      if (typeof fn === 'function') {
        try {
          fn(value);
          wrote = true;
        } catch {}
      }
      return wrote;
    }, token);
  } catch {
    return false;
  }
}

async function solveHcaptchaWithExternal(page: Page): Promise<string | undefined> {
  if (!externalCaptchaConfigured()) return undefined;
  const sitekey = await extractHcaptchaSitekey(page);
  if (!sitekey) return warn('External hCaptcha solver skipped: sitekey not found');
  const result = await solveWithExternalCaptchaSolver({ type: 'hcaptcha', sitekey, url: page.url() });
  if (!result.solved) {
    return warn(`External hCaptcha solver did not solve${result.error ? `: ${result.error}` : ''}`);
  }
  if (result.token) {
    const injected = await injectHcaptchaToken(page, result.token);
    if (injected) {
      return ok(`External hCaptcha solver returned token (${result.method || 'sidecar'}, injected)`);
    }
    return warn(
      `External hCaptcha solver returned token but no response field/callback accepted it (${result.method || 'sidecar'})`
    );
  }
  return warn(`External hCaptcha solver reported success without a token (${result.method || 'sidecar'})`);
}

export async function solveHcaptcha(
  page: Page,
  hcaptchaCheckbox: any,
  initialChallenge?: any
): Promise<string> {
  const results: string[] = ['Attempting hCaptcha...'];
  try {
    // 1) Prefer accessibility cookie (skip image challenge when valid)
    try {
      const ctx = page.context?.() || (page as any).context?.();
      if (ctx && typeof ctx.addCookies === 'function') {
        const inj = await injectA11yCookie(ctx);
        results.push(inj.injected ? ok(inj.reason) : warn(inj.reason));
        if (inj.injected) {
          // reload so widget picks up cookie for this origin's third-party jar
          try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForTimeout(1500);
          } catch {}
        } else if (needsA11yCookieFromUser()) {
          results.push(agentPromptForA11yCookie());
        }
      }
    } catch (e: any) {
      results.push(warn(`a11y inject skipped: ${e?.message || e}`));
    }

    // 2) External solver sidecar (if configured)
    const external = await solveHcaptchaWithExternal(page);
    if (external?.startsWith('[OK]')) return [...results, external].join('\n');
    if (external) results.push(external);

    // Re-classify frames after possible reload
    const frames = page.frames();
    const classified = classifyHcaptchaFrames(frames);
    const checkboxFrame = hcaptchaCheckbox || classified.checkbox;
    let challengeFrame = initialChallenge || classified.challenge;

    if (checkboxFrame && !challengeFrame) {
      const checkbox = checkboxFrame.locator('#checkbox, .check');
      if ((await checkbox.count()) === 0) {
        results.push(err('hCaptcha checkbox element not found in frame'));
        return results.join('\n');
      }
      await page.waitForTimeout(800 + Math.random() * 1200);
      await humanClick(checkbox, page);
      await page.waitForTimeout(3500);

      // a11y success: checkbox verified, no challenge
      const checkmark = checkboxFrame.locator(
        '.check.solved, #checkbox[aria-checked="true"], [aria-checked="true"]'
      );
      if ((await checkmark.count()) > 0) {
        results.push(ok('hCaptcha solved via accessibility cookie / checkbox', { status: 'verified' }));
        return results.join('\n');
      }

      challengeFrame = page.frames().find((frame) => isHcaptchaChallengeUrl(frame.url()));
      if (challengeFrame || (await detectChallengeAfterClick(page))) {
        results.push(
          warn(
            'Image challenge appeared — hc_accessibility expired or not accepted for this site/IP',
            {
              action: 'request fresh hc_accessibility from user, or fall back to grid solve',
            }
          )
        );
        if (!isA11yCookieValid()) {
          results.push(agentPromptForA11yCookie());
        }
      }
    }

    if (challengeFrame) {
      results.push('Image challenge appeared. Auto-solving...');
      const maxRetries = 5;
      let solved = false;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (attempt > 0) results.push(`\nRetry attempt ${attempt}/${maxRetries - 1}...`);
        const solveResult = await solveCaptchaGrid(page, challengeFrame, 'hcaptcha');
        results.push(solveResult);
        if (solveResult.includes('CAPTCHA SOLVED')) {
          solved = true;
          break;
        }
        if (solveResult.includes('Falling back to manual mode')) break;
        await page.waitForTimeout(2000);
        const newChallenge = page.frames().find((frame) => isHcaptchaChallengeUrl(frame.url()));
        if (!newChallenge) {
          results.push('Challenge frame disappeared, captcha may be solved');
          solved = true;
          break;
        }
        challengeFrame = newChallenge;
      }
      if (!solved && !results.some((result) => result.includes('Falling back'))) {
        results.push(
          `\nAuto-solve exhausted after ${maxRetries} attempts. Use "captcha-grid" and "click-tile" for manual solving.`
        );
        results.push(agentPromptForA11yCookie());
      }
      return results.join('\n');
    }

    if (checkboxFrame) {
      const checkmark = checkboxFrame.locator('.check.solved, #checkbox[aria-checked="true"]');
      if ((await checkmark.count()) > 0) {
        results.push(ok('hCaptcha solved', { status: 'verified' }));
      } else {
        results.push(
          warn('hCaptcha checkbox clicked, status unclear', {
            suggestion: 'Use "captcha-grid" to check for image challenge',
          })
        );
      }
    } else {
      results.push(
        err('hCaptcha checkbox or challenge frame not found', 'Use "detect-captcha" to scan for captcha type')
      );
    }
  } catch (e: any) {
    results.push(err(`hCaptcha click failed: ${e.message}`));
  }
  return results.join('\n');
}
