#!/usr/bin/env node

import { spawn } from 'child_process';

const WIB = 7 * 3600000;
const wibNow = () => new Date(Date.now() + WIB).toISOString().replace('T', ' ').substring(11, 19);

(async () => {
  console.log('=== Webshare Audio Test (Bot-like behavior) ===');
  console.log(`[${wibNow()}] Starting...`);

  const { chromium } = await import('playwright-core');

  const chromeArgs = [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--disable-infobares',
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
  console.log(`[${wibNow()}] ============================================`);
  console.log(`[${wibNow()}] ISI EMAIL DAN PASSWORD MANUAL SEKARANG`);
  console.log(`[${wibNow()}] Lalu centang consent checkbox`);
  console.log(`[${wibNow()}] Lalu klik "Sign Up With Email"`);
  console.log(`[${wibNow()}] Script akan otomatis handle reCAPTCHA`);
  console.log(`[${wibNow()}] ============================================`);

  // Wait for reCAPTCHA to appear (user fills form manually)
  console.log(`[${wibNow()}] Waiting for reCAPTCHA...`);
  
  for (let wait = 0; wait < 120; wait++) {
    const anchorFrame = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/anchor'));
    const bframe = page.frames().find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));

    if (anchorFrame) {
      // Check if already verified
      const checked = await anchorFrame.locator('.recaptcha-checkbox-checked, .rc-anchor-checkbox-checked, [aria-checked="true"]').count().catch(() => 0);
      if (checked > 0) {
        console.log(`[${wibNow()}] reCAPTCHA already verified!`);
        break;
      }

      // Check if image challenge is showing
      if (bframe) {
        const hasTable = await bframe.locator('table').count().catch(() => 0);
        if (hasTable > 0) {
          console.log(`[${wibNow()}] Image challenge detected!`);
          
          // Check for audio button
          const audioBtn = await bframe.locator('#recaptcha-audio-button, .rc-button-audio, [aria-label*="audio" i]').count().catch(() => 0);
          console.log(`[${wibNow()}] Audio button found: ${audioBtn > 0 ? 'YES' : 'NO'}`);
          
          if (audioBtn > 0) {
            console.log(`[${wibNow()}] Clicking audio button...`);
            try {
              await bframe.locator('#recaptcha-audio-button, .rc-button-audio, [aria-label*="audio" i]').first().click({ timeout: 5000 });
              console.log(`[${wibNow()}] Audio challenge loaded!`);
              await page.waitForTimeout(3000);
              
              // Check for audio challenge elements
              const audioChallenge = await bframe.locator('.audio-incorrect, .rc-audiochallenge, #audio-response, input[name="audio_response"]').count().catch(() => 0);
              console.log(`[${wibNow()}] Audio challenge elements: ${audioChallenge}`);
            } catch (e) {
              console.log(`[${wibNow()}] Audio button click failed: ${e.message.substring(0, 60)}`);
            }
          }
          break;
        }
      }

      // No challenge yet, try clicking checkbox
      if (wait === 5) {
        console.log(`[${wibNow()}] Clicking reCAPTCHA checkbox (bot-like, instant)...`);
        try {
          const checkbox = anchorFrame.locator('#recaptcha-anchor, .recaptcha-checkbox-border, .rc-anchor-checkbox').first();
          if (await checkbox.count() > 0) {
            await checkbox.click({ timeout: 5000 });
            console.log(`[${wibNow()}] Checkbox clicked`);
          }
        } catch (e) {
          console.log(`[${wibNow()}] Checkbox click failed: ${e.message.substring(0, 60)}`);
        }
      }
    }

    if (wait % 10 === 0 && wait > 0) {
      console.log(`[${wibNow()}] Still waiting... (${wait}s)`);
    }
    await page.waitForTimeout(1000);
  }

  console.log(`[${wibNow()}] === DONE ===`);
  console.log(`[${wibNow()}] Check the browser for reCAPTCHA state`);
  console.log(`[${wibNow()}] Browser stays open. Press Ctrl+C to exit.`);

  await new Promise((resolve) => {
    browser.on('disconnected', resolve);
    process.on('SIGINT', () => { chromeProc.kill(); resolve(); });
  });

  console.log('Bye!');
})();
