#!/usr/bin/env node

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const WIB = 7 * 3600000;
const wibNow = () => new Date(Date.now() + WIB).toISOString().replace('T', ' ').substring(11, 19);

(async () => {
  console.log('=== Webshare reCAPTCHA Test ===');
  console.log(`[${wibNow()}] Starting...`);

  const { chromium } = await import('playwright-core');
  const { solveCaptchaGrid } = await import('../dist/tools/captcha/RecaptchaSolver.js');

  const chromeArgs = [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--disable-infobars',
    '--password-store=basic',
    '--window-size=1200,900',
    '--remote-debugging-port=9222',
    '--proxy-server=http://127.0.0.1:18999',
    'about:blank',
  ];

  console.log(`[${wibNow()}] Spawning chromium...`);
  const chromeProc = spawn('/usr/bin/chromium', chromeArgs, {
    env: { ...process.env, DISPLAY: ':0', XAUTHORITY: '/var/run/lightdm/root/:0' },
    detached: false,
    stdio: 'ignore',
  });

  chromeProc.on('exit', () => console.log('Chromium exited'));
  await new Promise(r => setTimeout(r, 3000));

  let browser;
  try {
    browser = await chromium.connectOverCDP({ endpointURL: 'http://127.0.0.1:9222' });
  } catch (e) {
    console.error('Failed to connect:', e.message);
    chromeProc.kill();
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  page.on('dialog', async (d) => { try { await d.accept(''); } catch {} });

  console.log(`[${wibNow()}] Navigating to webshare signup...`);
  try {
    await page.goto('https://dashboard.webshare.io/register', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.error('Navigation failed:', e.message.split('\n')[0]);
    chromeProc.kill();
    process.exit(1);
  }
  await page.waitForTimeout(3000);
  console.log(`[${wibNow()}] Page loaded`);

  const fakeEmail = `test_${Date.now()}@protonmail.com`;
  const fakePass = 'TestPass123!@#';

  console.log(`[${wibNow()}] Filling form: ${fakeEmail}`);
  try {
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], input[label*="email" i]').first();
    if (await emailInput.count() > 0) {
      await emailInput.click();
      await emailInput.fill(fakeEmail);
      console.log(`[${wibNow()}] Email filled`);
    } else {
      const allInputs = page.locator('input:visible');
      const count = await allInputs.count();
      console.log(`[${wibNow()}] Found ${count} visible inputs, trying first two...`);
      if (count >= 1) { await allInputs.nth(0).click(); await allInputs.nth(0).fill(fakeEmail); }
      if (count >= 2) { await allInputs.nth(1).click(); await allInputs.nth(1).fill(fakePass); }
    }

    const passInput = page.locator('input[type="password"]').first();
    if (await passInput.count() > 0) {
      await passInput.click();
      await passInput.fill(fakePass);
      console.log(`[${wibNow()}] Password filled`);
    }

    const consentBox = page.locator('input[type="checkbox"]').first();
    if (await consentBox.count() > 0) {
      await consentBox.click();
      console.log(`[${wibNow()}] Consent checkbox clicked`);
    }
  } catch (e) {
    console.log(`[${wibNow()}] Form fill error: ${e.message.substring(0, 100)}`);
  }

  await page.waitForTimeout(1000);

  console.log(`[${wibNow()}] Clicking "Sign Up With Email"...`);
  try {
    const allBtns = await page.locator('button:visible').allTextContents();
    console.log(`[${wibNow()}] Visible buttons: ${allBtns.map(b => b.trim()).filter(Boolean).join(', ')}`);
    const signupBtn = page.locator('button:visible').filter({ hasText: /sign\s*up\s*with\s*email/i }).first();
    if (await signupBtn.count() > 0) {
      await signupBtn.click();
      console.log(`[${wibNow()}] "Sign Up With Email" clicked`);
    } else {
      const emailLink = page.locator('a:visible, div[role="button"]:visible').filter({ hasText: /sign\s*up\s*with\s*email/i }).first();
      if (await emailLink.count() > 0) {
        await emailLink.click();
        console.log(`[${wibNow()}] "Sign Up With Email" link clicked`);
      } else {
        console.log(`[${wibNow()}] "Sign Up With Email" not found`);
      }
    }
  } catch (e) {
    console.log(`[${wibNow()}] Button click error: ${e.message.substring(0, 100)}`);
  }

  console.log(`[${wibNow()}] Waiting for reCAPTCHA...`);
  await page.waitForTimeout(4000);

  let captchaFound = false;
  let verified = false;
  let checkboxClicked = false;

  for (let wait = 0; wait < 20; wait++) {
    const anchorFrame = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/anchor'));
    const bframe = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));

    if (anchorFrame) {
      const checked = await anchorFrame.locator('.recaptcha-checkbox-checked, .rc-anchor-checkbox-checked, [aria-checked="true"]').count().catch(() => 0);
      if (checked > 0) {
        console.log(`[${wibNow()}] reCAPTCHA verified (checkbox checked)!`);
        verified = true;
        break;
      }

      if (!checkboxClicked) {
        // Warmup: human-like mouse movements before clicking checkbox
        try {
          const vp = page.viewportSize() || { width: 1280, height: 720 };
          for (let i = 0; i < 3; i++) {
            await page.mouse.move(
              vp.width * (0.2 + Math.random() * 0.6),
              vp.height * (0.2 + Math.random() * 0.6),
              { steps: 10 + Math.floor(Math.random() * 15) }
            );
            await page.waitForTimeout(300 + Math.random() * 500);
          }
        } catch {}

        try {
          const clicked = await anchorFrame.evaluate(() => {
            const el = document.querySelector('#recaptcha-anchor') ||
                       document.querySelector('.recaptcha-checkbox-border') ||
                       document.querySelector('.rc-anchor-checkbox');
            if (el) {
              el.click();
              return true;
            }
            return false;
          });
          if (clicked) {
            console.log(`[${wibNow()}] Clicked reCAPTCHA checkbox via JS`);
            checkboxClicked = true;
            await page.waitForTimeout(3000);
            continue;
          }
        } catch (e) {
          console.log(`[${wibNow()}] Checkbox JS click failed: ${e.message.substring(0, 60)}`);
        }

        const checkbox = anchorFrame.locator('#recaptcha-anchor, .recaptcha-checkbox-border, .rc-anchor-checkbox').first();
        if (await checkbox.count() > 0) {
          const isVisible = await checkbox.isVisible().catch(() => false);
          if (isVisible) {
            console.log(`[${wibNow()}] Clicking reCAPTCHA checkbox via locator...`);
            await checkbox.click({ timeout: 5000 }).catch((e) => console.log(`[${wibNow()}] Click failed: ${e.message.substring(0, 60)}`));
            checkboxClicked = true;
            await page.waitForTimeout(3000);
            continue;
          }
        }
      }
    }

    if (bframe) {
      const hasTable = await bframe.locator('table').count().catch(() => 0);
      if (hasTable > 0) {
        captchaFound = true;
        console.log(`[${wibNow()}] reCAPTCHA image challenge found!`);
        break;
      }
      const bframeText = await bframe.locator('body').textContent().catch(() => '');
      if (bframeText.length > 0 && wait % 3 === 0) {
        console.log(`[${wibNow()}] bframe text: "${bframeText.substring(0, 80).replace(/\s+/g, ' ')}"`);
      }
    }

    console.log(`[${wibNow()}] Waiting... (${wait + 1}/20) anchor=${!!anchorFrame} bframe=${!!bframe} checkboxClicked=${checkboxClicked}`);
    await page.waitForTimeout(2000);
  }

  if (verified) {
    console.log(`[${wibNow()}] Already verified, waiting for form submission...`);
    await page.waitForTimeout(3000);
    const newUrl = page.url();
    if (!newUrl.includes('register')) {
      console.log(`[${wibNow()}] SUCCESS! Navigated to: ${newUrl}`);
    }
  }

  if (!captchaFound && !verified) {
    const anchorFrame = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/anchor'));
    if (anchorFrame) {
      const checkbox = anchorFrame.locator('#recaptcha-anchor, .recaptcha-checkbox-border, .rc-anchor-checkbox').first();
      if (await checkbox.count() > 0 && await checkbox.isVisible().catch(() => false)) {
        console.log(`[${wibNow()}] Final attempt: clicking reCAPTCHA checkbox...`);
        await checkbox.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(4000);
        const bframe = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
        if (bframe) {
          const hasTable = await bframe.locator('table').count().catch(() => 0);
          if (hasTable > 0) captchaFound = true;
        }
      }
    }
  }

  if (!captchaFound && !verified) {
    console.log(`[${wibNow()}] No reCAPTCHA challenge found. Check the browser.`);
    console.log(`[${wibNow()}] Frames: ${page.frames().map(f => f.url().substring(0, 60)).join('\n  ')}`);
  }

  let totalSolved = verified ? 1 : 0;
  const MAX_ATTEMPTS = 10;
  const stats = { flip3x3: { total: 0, pass: 0 }, static3x3: { total: 0, pass: 0 }, grid4x4: { total: 0, pass: 0 }, unknown: { total: 0, pass: 0 } };

  if (verified) {
    console.log(`[${wibNow()}] Already solved, skipping solve loop.`);
  } else for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let bframe = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
    if (!bframe) {
      console.log(`[${wibNow()}] No bframe, checking for success...`);
      break;
    }

    const hasTable = await bframe.locator('table').count().catch(() => 0);
    if (hasTable === 0) {
      const anchorFrame = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/anchor'));
      if (anchorFrame) {
        const checked = await anchorFrame.locator('.recaptcha-checkbox-checked').count().catch(() => 0);
        if (checked > 0) {
          console.log(`[${wibNow()}] SOLVED! reCAPTCHA verified.`);
          totalSolved++;
          break;
        }
      }
      await page.waitForTimeout(2000);
      continue;
    }

    console.log(`[${wibNow()}] Solving challenge (attempt ${attempt})...`);
    let solverResult = '';
    let allResults = [];
    let subRound = 0;
    const MAX_SUB = 5;
    while (subRound < MAX_SUB) {
      subRound++;
      let result = '';
      try {
        result = await solveCaptchaGrid(page, bframe, 'recaptcha');
        const lines = result.split('\n').filter(l => l.trim());
        console.log(`[${wibNow()}] Solver result (sub ${subRound}):`);
        for (const line of lines.slice(-8)) console.log(`  ${line}`);
      } catch (e) {
        console.log(`[${wibNow()}] Solver error: ${e.message.substring(0, 100)}`);
      }
      allResults.push(result);
      solverResult = result;

      const isVerified = result.includes('[VERIFIED]') || result.includes('[BFRAME_GONE]');
      const isNewChallenge = result.includes('[NEW_CHALLENGE]');
      if (isVerified || !isNewChallenge) break;

      console.log(`[${wibNow()}] Sub-challenge passed, solving next...`);
      // Human-like pause with random mouse movements
      const vp = page.viewportSize() || { width: 1200, height: 900 };
      for (let m = 0; m < 3; m++) {
        await page.mouse.move(
          vp.width * (0.1 + Math.random() * 0.8),
          vp.height * (0.1 + Math.random() * 0.8),
          { steps: 10 + Math.floor(Math.random() * 15) }
        );
        await page.waitForTimeout(500 + Math.random() * 1000);
      }
      await page.waitForTimeout(1000 + Math.random() * 2000);
      const newBframe = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
      if (!newBframe) break;
      bframe = newBframe;
    }

    const instrLine = solverResult.split('\n').find(l => l.includes('instruction:')) || allResults[0].split('\n').find(l => l.includes('instruction:')) || '';
    const firstResult = allResults[0];
    const is3x3 = firstResult.includes('3x3');
    const is3x3Flip = /verify once there are none left/i.test(instrLine);
    const is3x3Static = is3x3 && !is3x3Flip;
    const is4x4 = !is3x3;
    const passed = solverResult.includes('[VERIFIED]') || solverResult.includes('[BFRAME_GONE]');

    let cat = 'unknown';
    if (is4x4) cat = 'grid4x4';
    else if (is3x3Flip) cat = 'flip3x3';
    else if (is3x3Static) cat = 'static3x3';
    stats[cat].total++;
    if (passed) stats[cat].pass++;

    console.log(`[${wibNow()}] Type: ${cat} | Result: ${passed ? 'PASS' : 'FAIL'} | Stats: flip3x3=${stats.flip3x3.pass}/${stats.flip3x3.total} 4x4=${stats.grid4x4.pass}/${stats.grid4x4.total} static3x3=${stats.static3x3.pass}/${stats.static3x3.total}`);

    try {
      const { copyFileSync } = await import('fs');
      copyFileSync(join(homedir(), '.aurix-captcha-grid.png'), join(homedir(), `.aurix-grid-attempt-${attempt}-${cat}.png`));
    } catch {}

    await page.waitForTimeout(3000);

    const token = await page.evaluate(() => {
      const el = document.getElementById('g-recaptcha-response');
      return el ? el.value : '';
    }).catch(() => '');

    const isVerified = solverResult.includes('[VERIFIED]') || (token && token.length > 10);

    const anchorFrame = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/anchor'));
    if (anchorFrame) {
      const checked = await anchorFrame.locator('.recaptcha-checkbox-checked, [aria-checked="true"]').count().catch(() => 0);
      if (checked > 0 || isVerified) {
        console.log(`[${wibNow()}] reCAPTCHA VERIFIED! Submitting form...`);
        totalSolved++;
        try {
          const submitBtn = page.locator('button:visible').filter({ hasText: /sign\s*up\s*with\s*email/i }).first();
          if (await submitBtn.count() > 0) {
            await submitBtn.click();
            console.log(`[${wibNow()}] Form submitted!`);
          } else {
            const anySubmit = page.locator('button[type="submit"]:visible, input[type="submit"]:visible').first();
            if (await anySubmit.count() > 0) {
              await anySubmit.click();
              console.log(`[${wibNow()}] Form submitted via generic button!`);
            }
          }
          await page.waitForTimeout(5000);
        } catch (e) {
          console.log(`[${wibNow()}] Submit error: ${e.message.substring(0, 80)}`);
        }
        const newUrl = page.url();
        if (!newUrl.includes('register') && !newUrl.includes('login')) {
          console.log(`[${wibNow()}] SUCCESS! Navigated to: ${newUrl}`);
        } else {
          console.log(`[${wibNow()}] Still on: ${newUrl}`);
        }
        break;
      }
    }

    const currentUrl = page.url();
    if (!currentUrl.includes('register') && !currentUrl.includes('login') && !currentUrl.includes('auth')) {
      console.log(`[${wibNow()}] Page navigated to: ${currentUrl} — likely success!`);
      totalSolved++;
      break;
    }
  }

  console.log(`\n[${wibNow()}] === DONE ===`);
  console.log(`Solved: ${totalSolved > 0 ? 'YES' : 'NO'}`);
  console.log(`Current URL: ${page.url()}`);
  console.log(`\n=== PASS RATES ===`);
  console.log(`3x3 flip:  ${stats.flip3x3.pass}/${stats.flip3x3.total} (${stats.flip3x3.total > 0 ? Math.round(stats.flip3x3.pass/stats.flip3x3.total*100) : 0}%)`);
  console.log(`3x3 static: ${stats.static3x3.pass}/${stats.static3x3.total} (${stats.static3x3.total > 0 ? Math.round(stats.static3x3.pass/stats.static3x3.total*100) : 0}%)`);
  console.log(`4x4 grid:  ${stats.grid4x4.pass}/${stats.grid4x4.total} (${stats.grid4x4.total > 0 ? Math.round(stats.grid4x4.pass/stats.grid4x4.total*100) : 0}%)`);
  console.log('');
  console.log('\n=== Done. Exiting. ===');
  chromeProc.kill();
  process.exit(0);
})();
