import { createConfiguredCapSolverClient } from './CapSolverClient.js';
import { extractTurnstileDetails, injectTurnstileToken, detectTurnstile } from './TurnstileSolver.js';

export type BrowserFallbackResult = {
  attempted: boolean;
  solved: boolean;
  message: string;
  taskId?: string;
};

function solutionToken(solution?: Record<string, unknown>): string {
  return String(
    solution?.gRecaptchaResponse ||
      solution?.token ||
      solution?.captcha_response ||
      solution?.captchaResponse ||
      ''
  ).trim();
}

export async function solveWithCapSolverFallback(
  page: any,
  captchaType: string,
  timeoutMs = 90_000
): Promise<BrowserFallbackResult> {
  const client = createConfiguredCapSolverClient();
  if (!client) return { attempted: false, solved: false, message: 'CapSolver fallback is disabled' };

  const details = await page.evaluate(() => {
    const recaptcha = document.querySelector('[data-sitekey], .g-recaptcha') as HTMLElement | null;
    const mtcaptcha = document.querySelector('[data-mtcaptcha-sitekey], .mtcaptcha') as HTMLElement | null;
    const geetest = document.querySelector('[data-captcha-id], [data-gt]') as HTMLElement | null;
    return {
      websiteURL: location.href,
      websiteKey:
        recaptcha?.getAttribute('data-sitekey') ||
        mtcaptcha?.getAttribute('data-mtcaptcha-sitekey') ||
        mtcaptcha?.getAttribute('data-sitekey') ||
        '',
      captchaId: geetest?.getAttribute('data-captcha-id') || '',
      gt: geetest?.getAttribute('data-gt') || '',
      challenge: geetest?.getAttribute('data-challenge') || '',
      enterprise: Boolean(document.querySelector('script[src*="recaptcha/enterprise"]')),
    };
  });

  if (captchaType === 'recaptcha' && !details.websiteKey) {
    for (const frame of page.frames()) {
      try {
        const url = new URL(frame.url());
        if (url.hostname.includes('google.com') || url.hostname.includes('recaptcha.net')) {
          details.websiteKey = url.searchParams.get('k') || details.websiteKey;
        }
      } catch {}
    }
  }

  let task: Record<string, unknown>;
  let turnstileDetails: Awaited<ReturnType<typeof extractTurnstileDetails>> | undefined;
  if (captchaType === 'recaptcha') {
    if (!details.websiteKey) return { attempted: false, solved: false, message: 'CapSolver fallback could not extract the reCAPTCHA site key' };
    task = {
      type: details.enterprise ? 'ReCaptchaV2EnterpriseTaskProxyLess' : 'ReCaptchaV2TaskProxyLess',
      websiteURL: details.websiteURL,
      websiteKey: details.websiteKey,
    };
  } else if (captchaType === 'mtcaptcha') {
    if (!details.websiteKey) return { attempted: false, solved: false, message: 'CapSolver fallback could not extract the MTCaptcha site key' };
    task = { type: 'MtCaptchaTaskProxyLess', websiteURL: details.websiteURL, websiteKey: details.websiteKey };
  } else if (captchaType === 'geetest') {
    if (!details.captchaId && (!details.gt || !details.challenge)) {
      return { attempted: false, solved: false, message: 'CapSolver fallback could not extract GeeTest parameters' };
    }
    task = {
      type: 'GeeTestTaskProxyLess',
      websiteURL: details.websiteURL,
      ...(details.captchaId ? { captchaId: details.captchaId } : { gt: details.gt, challenge: details.challenge }),
    };
  } else if (captchaType === 'turnstile') {
    turnstileDetails = await extractTurnstileDetails(page);
    if (!turnstileDetails.websiteKey) {
      return { attempted: false, solved: false, message: 'CapSolver fallback could not extract the Turnstile site key' };
    }
    task = {
      type: 'AntiTurnstileTaskProxyLess',
      websiteURL: details.websiteURL,
      websiteKey: turnstileDetails.websiteKey,
      ...((turnstileDetails.action || turnstileDetails.cdata)
        ? {
            metadata: {
              ...(turnstileDetails.action ? { action: turnstileDetails.action } : {}),
              ...(turnstileDetails.cdata ? { cdata: turnstileDetails.cdata } : {}),
            },
          }
        : {}),
    };
  } else {
    return { attempted: false, solved: false, message: `CapSolver fallback has no safe automatic task mapping for ${captchaType}` };
  }

  const result = await client.solveTask(task, { timeoutMs });
  if (!result.ok || !result.solution) {
    return { attempted: true, solved: false, taskId: result.taskId, message: result.error || 'CapSolver did not return a solution' };
  }

  if (captchaType === 'turnstile') {
    const token = solutionToken(result.solution);
    if (!token) return { attempted: true, solved: false, taskId: result.taskId, message: 'CapSolver Turnstile solution did not contain a token' };
    const startUrl = page.url();
    const injected = await injectTurnstileToken(page, token);
    if (!injected.wrote) return { attempted: true, solved: false, taskId: result.taskId, message: 'CapSolver Turnstile token returned but no response field accepted it' };
    await page.waitForTimeout(1500);
    const tokenPresent = await page.evaluate(() => {
      const field = document.querySelector('textarea[name="cf-turnstile-response"], input[name="cf-turnstile-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
      return Boolean(field?.value.trim());
    });
    const progressed = page.url() !== startUrl || (injected.callbackInvoked && !(await detectTurnstile(page)));
    if (!progressed && !tokenPresent) return { attempted: true, solved: false, taskId: result.taskId, message: 'CapSolver Turnstile token injection was not retained by the page' };
    return {
      attempted: true,
      solved: true,
      taskId: result.taskId,
      message: progressed
        ? 'CapSolver Turnstile fallback verified after native solving was exhausted'
        : 'CapSolver Turnstile token is ready in the form response field; submit the form to complete site verification',
    };
  }

  if (captchaType === 'recaptcha' || captchaType === 'mtcaptcha') {
    const token = solutionToken(result.solution);
    if (!token) return { attempted: true, solved: false, taskId: result.taskId, message: 'CapSolver solution did not contain a token' };
    const beforeUrl = page.url();
    const injected = await page.evaluate((value: string) => {
      const selectors = [
        'textarea[name="g-recaptcha-response"]',
        'input[name="mtcaptcha-verifiedtoken"]',
        'input[name*="captcha-token"]',
      ];
      let count = 0;
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          const input = element as HTMLInputElement | HTMLTextAreaElement;
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          count++;
        }
      }
      const widget = document.querySelector('[data-callback]') as HTMLElement | null;
      const callbackName = widget?.getAttribute('data-callback') || '';
      const callback = callbackName
        .split('.')
        .filter(Boolean)
        .reduce<unknown>((current, part) =>
          current && typeof current === 'object'
            ? (current as Record<string, unknown>)[part]
            : undefined, window as unknown);
      let callbackInvoked = false;
      if (typeof callback === 'function') {
        try {
          (callback as (response: string) => void)(value);
          callbackInvoked = true;
        } catch {}
      }
      return { count, callbackInvoked };
    }, token);
    if (!injected.count) return { attempted: true, solved: false, taskId: result.taskId, message: 'CapSolver token returned but no compatible page field was found' };
    await page.waitForTimeout(1500);
    const challengeVisible = await page.evaluate(() => Boolean(
      document.querySelector('.rc-imageselect, iframe[src*="recaptcha"][src*="bframe"], .mtcaptcha, [class*="captcha-challenge"]')
    ));
    const progressed = page.url() !== beforeUrl || (injected.callbackInvoked && !challengeVisible);
    if (!progressed) {
      return { attempted: true, solved: false, taskId: result.taskId, message: 'CapSolver token was injected but page verification did not progress' };
    }
    return { attempted: true, solved: true, taskId: result.taskId, message: 'CapSolver fallback verified after native solving was exhausted' };
  }

  return { attempted: true, solved: false, taskId: result.taskId, message: 'GeeTest solution returned, but automatic injection is unavailable for this widget implementation' };
}
