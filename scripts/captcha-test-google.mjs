#!/usr/bin/env node

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, appendFileSync, copyFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const WIB = 7 * 3600000;
const wibNow = () => new Date(Date.now() + WIB).toISOString().replace('T', ' ').substring(11, 19);

(async () => {
  console.log('=== Google Demo reCAPTCHA Test (3x3 flip focus) ===');
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
    'about:blank',
  ];

  console.log(`[${wibNow()}] Spawning chromium...`);
  const chromeProc = spawn('/usr/bin/chromium', chromeArgs, {
    env: { ...process.env, DISPLAY: ':0', XAUTHORITY: '/var/run/lightdm/root/:0' },
    detached: false,
    stdio: 'ignore',
  });

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

  console.log(`[${wibNow()}] Navigating to Google reCAPTCHA demo...`);
  await page.goto('https://www.google.com/recaptcha/api2/demo', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log(`[${wibNow()}] Page loaded`);

  const stats = { flip3x3: { total: 0, pass: 0 }, static3x3: { total: 0, pass: 0 }, grid4x4: { total: 0, pass: 0 } };
  let totalAttempts = 0;

  for (let cycle = 1; cycle <= 10; cycle++) {
    console.log(`\n[${wibNow()}] === CYCLE ${cycle} ===`);

    // Click the reCAPTCHA checkbox
    const anchorFrame = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/anchor'));
    if (!anchorFrame) {
      console.log(`[${wibNow()}] No anchor frame found`);
      await page.waitForTimeout(2000);
      continue;
    }

    const checked = await anchorFrame.locator('.recaptcha-checkbox-checked, [aria-checked="true"]').count().catch(() => 0);
    if (checked > 0) {
      console.log(`[${wibNow()}] Already verified!`);
      // Reload to get new challenge
      await page.goto('https://www.google.com/recaptcha/api2/demo', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      continue;
    }

    try {
      const checkbox = anchorFrame.locator('#recaptcha-anchor, .recaptcha-checkbox-border').first();
      if (await checkbox.count() > 0 && await checkbox.isVisible().catch(() => false)) {
        await checkbox.click({ timeout: 5000 });
        console.log(`[${wibNow()}] Clicked checkbox`);
        await page.waitForTimeout(3000);
      }
    } catch (e) {
      console.log(`[${wibNow()}] Checkbox click error: ${e.message.substring(0, 60)}`);
    }

    // Check for image challenge
    let bframe = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
    if (!bframe) {
      console.log(`[${wibNow()}] No bframe`);
      continue;
    }

    const hasTable = await bframe.locator('table').count().catch(() => 0);
    if (hasTable === 0) {
      const anchorChecked = await anchorFrame.locator('.recaptcha-checkbox-checked, [aria-checked="true"]').count().catch(() => 0);
      if (anchorChecked > 0) {
        console.log(`[${wibNow()}] Passed without challenge!`);
        await page.goto('https://www.google.com/recaptcha/api2/demo', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
        continue;
      }
      console.log(`[${wibNow()}] No table in bframe`);
      continue;
    }

    totalAttempts++;
    console.log(`[${wibNow()}] Solving challenge (attempt ${totalAttempts})...`);

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

      // 4x4 sub-challenge: human-like pause then solve next
      console.log(`[${wibNow()}] Sub-challenge passed, solving next...`);
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

    let cat = 'grid4x4';
    if (is3x3Flip) cat = 'flip3x3';
    else if (is3x3Static) cat = 'static3x3';
    stats[cat].total++;
    if (passed) stats[cat].pass++;

    console.log(`[${wibNow()}] Type: ${cat} | Result: ${passed ? 'PASS' : 'FAIL'} | Stats: flip3x3=${stats.flip3x3.pass}/${stats.flip3x3.total} 4x4=${stats.grid4x4.pass}/${stats.grid4x4.total} static3x3=${stats.static3x3.pass}/${stats.static3x3.total}`);

    try {
      copyFileSync(join(homedir(), '.aurix-captcha-grid.png'), join(homedir(), `.aurix-grid-attempt-${totalAttempts}-${cat}.png`));
    } catch {}

    await page.waitForTimeout(2000);

    // Check if verified
    const token = await page.evaluate(() => {
      const el = document.getElementById('g-recaptcha-response');
      return el ? el.value : '';
    }).catch(() => '');

    if (token && token.length > 10) {
      console.log(`[${wibNow()}] VERIFIED! Reloading for next cycle...`);
      await page.goto('https://www.google.com/recaptcha/api2/demo', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    }
  }

  console.log(`\n=== FINAL PASS RATES ===`);
  console.log(`3x3 flip:   ${stats.flip3x3.pass}/${stats.flip3x3.total} (${stats.flip3x3.total > 0 ? Math.round(stats.flip3x3.pass/stats.flip3x3.total*100) : 0}%)`);
  console.log(`3x3 static: ${stats.static3x3.pass}/${stats.static3x3.total} (${stats.static3x3.total > 0 ? Math.round(stats.static3x3.pass/stats.static3x3.total*100) : 0}%)`);
  console.log(`4x4 grid:   ${stats.grid4x4.pass}/${stats.grid4x4.total} (${stats.grid4x4.total > 0 ? Math.round(stats.grid4x4.pass/stats.grid4x4.total*100) : 0}%)`);

  console.log('\n=== Done. Exiting. ===');
  chromeProc.kill();
  process.exit(0);
})();
