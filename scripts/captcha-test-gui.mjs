#!/usr/bin/env node

/**
 * AURIX Captcha Auto-Solve Test (GUI mode)
 * Opens a visible browser, navigates to reCAPTCHA demo,
 * and lets the agent solve captchas automatically using vision API.
 *
 * Usage: node scripts/captcha-test-gui.mjs [rounds]
 */

import { spawn } from 'child_process';
import http from 'http';
import net from 'net';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const ROUNDS = parseInt(process.argv[2] || '3');

function loadProxies() {
  try {
    const yaml = readFileSync(join(homedir(), '.aurix', 'config.yaml'), 'utf-8');
    const lines = yaml.split('\n');
    const proxies = [];
    let inProxies = false;
    for (const line of lines) {
      if (/^[\s]*proxies:/.test(line)) { inProxies = true; continue; }
      if (inProxies) {
        const m = line.match(/^\s*-\s*(.+)/);
        if (m) {
          const parts = m[1].trim().split(':');
          if (parts.length >= 4) {
            proxies.push({ host: parts[0], port: parseInt(parts[1]), user: parts[2], pass: parts[3] });
          }
        } else if (line.trim() && !line.trim().startsWith('#')) {
          inProxies = false;
        }
      }
    }
    return proxies;
  } catch { return []; }
}

const WIB = 7 * 3600000;
const wibNow = () => new Date(Date.now() + WIB).toISOString().replace('T', ' ').substring(11, 19);

(async () => {
  console.log('=== AURIX Captcha Auto-Solve Test (GUI) ===');
  console.log(`[${wibNow()}] Rounds: ${ROUNDS}`);
  console.log('');

  const { chromium } = await import('playwright-core');
  const { solveCaptchaGrid } = await import('../dist/tools/captcha/RecaptchaSolver.js');

  // Spawn chromium manually (CDP approach)
  const chromeArgs = [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--disable-infobars',
    '--password-store=basic',
    '--window-size=1100,900',
    '--remote-debugging-port=9222',
    'about:blank',
  ];

  console.log(`[${wibNow()}] Spawning chromium on DISPLAY=:0...`);
  const chromeProc = spawn('/usr/bin/chromium', chromeArgs, {
    env: { ...process.env, DISPLAY: ':0', XAUTHORITY: '/var/run/lightdm/root/:0' },
    detached: false,
    stdio: 'ignore',
  });

  chromeProc.on('exit', () => {
    console.log('Chromium exited');
  });

  await new Promise(r => setTimeout(r, 3000));

  let browser;
  try {
    browser = await chromium.connectOverCDP({ endpointURL: 'http://127.0.0.1:9222' });
  } catch (e) {
    console.error('Failed to connect to chromium CDP:', e.message);
    chromeProc.kill();
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0];
  const page = context.pages()[0] || await context.newPage();

  page.on('dialog', async (dialog) => {
    try { await dialog.accept('root'); } catch {}
  });

  // Navigate to reCAPTCHA demo (direct, no proxy)
  console.log(`[${wibNow()}] Navigating to reCAPTCHA demo...`);
  try {
    await page.goto('https://www.google.com/recaptcha/api2/demo', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.error('Navigation failed:', e.message.split('\n')[0]);
    chromeProc.kill();
    process.exit(1);
  }
  await page.waitForTimeout(3000);
  console.log(`[${wibNow()}] Page loaded`);

  let totalSolved = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n[${wibNow()}] === ROUND ${round}/${ROUNDS} ===`);

    // Click "I'm not a robot" checkbox
    const anchorFrame = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/anchor'));
    if (!anchorFrame) {
      console.log(`[${wibNow()}] No reCAPTCHA anchor frame found, skipping`);
      break;
    }

    try {
      const checkbox = anchorFrame.locator('#recaptcha-anchor, .recaptcha-checkbox-border, .rc-anchor-checkbox').first();
      if (await checkbox.count() > 0) {
        console.log(`[${wibNow()}] Clicking "I'm not a robot"...`);
        await checkbox.click({ timeout: 5000 });
        await page.waitForTimeout(3000);
      }
    } catch (e) {
      console.log(`[${wibNow()}] Checkbox click failed: ${e.message.substring(0, 80)}`);
    }

    // Check if already verified (no image challenge)
    const checked = await anchorFrame.locator('.recaptcha-checkbox-checked, .rc-anchor-checkbox-checked').count().catch(() => 0);
    if (checked > 0) {
      console.log(`[${wibNow()}] Verified without image challenge!`);
      totalSolved++;
      continue;
    }

    // Solve image challenges
    let solveAttempts = 0;
    const MAX_ATTEMPTS = 10;

    while (solveAttempts < MAX_ATTEMPTS) {
      const bframe = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
      if (!bframe) {
        console.log(`[${wibNow()}] No bframe found, waiting...`);
        await page.waitForTimeout(2000);
        continue;
      }

      // Check if challenge is visible
      const hasTable = await bframe.locator('table').count().catch(() => 0);
      if (hasTable === 0) {
        // Maybe verification succeeded
        const token = await page.evaluate(() => {
          const el = document.getElementById('g-recaptcha-response');
          return el ? el.value : '';
        }).catch(() => '');

        if (token && token.length > 10) {
          console.log(`[${wibNow()}] SOLVED! Token received.`);
          totalSolved++;
          break;
        }
        await page.waitForTimeout(2000);
        continue;
      }

      solveAttempts++;
      console.log(`[${wibNow()}] Solving challenge (attempt ${solveAttempts})...`);

      try {
        const result = await solveCaptchaGrid(page, bframe, 'recaptcha');
        console.log(`[${wibNow()}] Solver result:`);
        const lines = result.split('\n').filter(l => l.trim());
        for (const line of lines.slice(-5)) {
          console.log(`  ${line}`);
        }
      } catch (e) {
        console.log(`[${wibNow()}] Solver error: ${e.message.substring(0, 100)}`);
      }

      await page.waitForTimeout(3000);

      // Check for token after solve attempt
      const token = await page.evaluate(() => {
        const el = document.getElementById('g-recaptcha-response');
        return el ? el.value : '';
      }).catch(() => '');

      if (token && token.length > 10) {
        console.log(`[${wibNow()}] SOLVED! Token received after ${solveAttempts} attempts.`);
        totalSolved++;
        break;
      }

      // Check if new challenge appeared (sub-challenge in same round)
      console.log(`[${wibNow()}] Sub-challenge detected, continuing...`);
    }

    if (solveAttempts >= MAX_ATTEMPTS) {
      console.log(`[${wibNow()}] Max attempts reached for round ${round}`);
    }

    // Try to reset for next round
    if (round < ROUNDS) {
      await page.waitForTimeout(3000);
      try {
        const reloadBtn = page.locator('#recaptcha-demo-button, button:has-text("Try again"), button:has-text("Reload")').first();
        if (await reloadBtn.count() > 0) {
          await reloadBtn.click();
          await page.waitForTimeout(2000);
        }
      } catch {}
    }
  }

  console.log(`\n[${wibNow()}] === DONE ===`);
  console.log(`Solved: ${totalSolved}/${ROUNDS} rounds`);
  console.log('');
  console.log('Press Ctrl+C to exit or close the browser window.');

  await new Promise((resolve) => {
    browser.on('disconnected', resolve);
    process.on('SIGINT', () => {
      chromeProc.kill();
      resolve();
    });
  });

  console.log('Bye!');
})();
