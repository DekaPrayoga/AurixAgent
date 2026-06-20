#!/usr/bin/env node

/**
 * AURIX Captcha Manual Training
 * Opens reCAPTCHA challenges, screenshots each grid, asks user for correct tiles.
 * Saves training data to training/captcha-training-manual.json
 *
 * Usage: node scripts/captcha-train-manual.mjs [rounds]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import http from 'http';
import net from 'net';
import readline from 'readline';
import { spawn } from 'child_process';

const projectRoot = '/root/main/aurix-agent';
const trainingDir = join(projectRoot, 'training');
const screenshotsDir = join(trainingDir, 'manual-screenshots');
const outputFile = join(trainingDir, 'captcha-training-manual.json');

const ROUNDS = parseInt(process.argv[2] || '20');

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

const PROXIES = loadProxies();
let proxyIdx = Math.floor(Math.random() * Math.max(1, PROXIES.length));

function startProxyForwarder(upstream, localPort) {
  const auth = 'Basic ' + Buffer.from(upstream.user + ':' + upstream.pass).toString('base64');
  const server = http.createServer((req, res) => {
    const opts = {
      hostname: upstream.host, port: upstream.port, method: req.method, path: req.url,
      headers: { ...req.headers, 'Proxy-Authorization': auth }
    };
    delete opts.headers['proxy-connection'];
    const proxy = http.request(opts, pRes => { res.writeHead(pRes.statusCode, pRes.headers); pRes.pipe(res); });
    proxy.on('error', e => { res.writeHead(502); res.end(); });
    req.pipe(proxy);
  });
  server.on('connect', (req, clientSocket, head) => {
    const conn = net.connect(upstream.port, upstream.host, () => {
      conn.write('CONNECT ' + req.url + ' HTTP/1.1\r\nHost: ' + req.url + '\r\nProxy-Authorization: ' + auth + '\r\n\r\n');
      conn.once('data', d => {
        if (d.toString().includes('200')) {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) conn.write(head);
          conn.pipe(clientSocket); clientSocket.pipe(conn);
        } else { clientSocket.end(); }
      });
    });
    conn.on('error', () => clientSocket.end());
  });
  return new Promise((resolve) => {
    server.listen(localPort, '127.0.0.1', () => resolve(server));
  });
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) {
  return new Promise(resolve => rl.question(q, a => resolve(a.trim())));
}

if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

let trainingData = [];
if (existsSync(outputFile)) {
  try {
    trainingData = JSON.parse(readFileSync(outputFile, 'utf-8'));
    console.log(`Loaded ${trainingData.length} existing entries`);
  } catch {}
}

let lastViewer = null;
function openScreenshot(path) {
  try {
    if (lastViewer && !lastViewer.killed) {
      try { lastViewer.kill(); } catch {}
    }
    lastViewer = spawn('ristretto', [path], { detached: true, stdio: 'ignore' });
    lastViewer.unref();
  } catch {
    try {
      lastViewer = spawn('eog', [path], { detached: true, stdio: 'ignore' });
      lastViewer.unref();
    } catch {}
  }
}

async function checkVerification(page, oldInstruction) {
  // Check for token (FULL SUCCESS)
  let hasToken = false;
  try {
    hasToken = await page.evaluate(() => {
      const el = document.getElementById('g-recaptcha-response');
      return !!(el && el.value && el.value.length > 10);
    });
  } catch {}
  if (hasToken) return { status: 'SOLVED', message: '🎉 VERIFICATION SUCCESS! 🎉 Token generated.' };

  // Check aria-checked on anchor
  let ariaChecked = false;
  try {
    for (const f of page.frames()) {
      if (f.url().includes('/recaptcha/') && f.url().includes('/anchor')) {
        const count = await f.locator('#recaptcha-anchor[aria-checked="true"]').count();
        if (count > 0) { ariaChecked = true; break; }
      }
    }
  } catch {}
  if (ariaChecked) return { status: 'SOLVED', message: '🎉 VERIFICATION SUCCESS! 🎉 Checkbox checked.' };

  // Check if bframe gone
  const hasBframe = page.frames().some(f => f.url().includes('/recaptcha/api2/bframe'));
  if (!hasBframe) return { status: 'SOLVED', message: '🎉 VERIFICATION SUCCESS! 🎉 Challenge closed.' };

  // Check new instruction
  let newInstruction = '';
  try {
    const bframe = page.frames().find(f => f.url().includes('/recaptcha/api2/bframe'));
    if (bframe) {
      newInstruction = await bframe.evaluate(() => {
        const el = document.querySelector('.rc-imageselect-instructions .rc-imageselect-desc-wrapper, .prompt-text');
        return el ? (el.textContent || '').trim() : '';
      });
    }
  } catch {}

  const oldClean = oldInstruction.replace(/\s+/g, ' ').trim();
  const newClean = newInstruction.replace(/\s+/g, ' ').trim();
  if (newInstruction && newClean !== oldClean) {
    return { status: 'NEW', message: `✓ CORRECT! New challenge: ${newClean.substring(0, 80)}` };
  }

  // Check for error indicator
  let hasError = false;
  try {
    const bframe = page.frames().find(f => f.url().includes('/recaptcha/api2/bframe'));
    if (bframe) {
      hasError = await bframe.evaluate(() => {
        const el = document.querySelector('.rc-imageselect-incorrect-response, .rc-imageselect-error-select');
        return !!el;
      });
    }
  } catch {}
  if (hasError) return { status: 'WRONG', message: '✗ WRONG answer (error shown). Try again.' };

  // Same instruction = wrong answer
  if (newInstruction && newClean === oldClean) {
    return { status: 'WRONG', message: '✗ WRONG answer (same challenge). Try again.' };
  }

  return { status: 'UNKNOWN', message: '? Unknown state.' };
}

let stats = { success: 0, wrong: 0, solved: 0 };

async function waitForChallengeFrame(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(1000);
    const frame = page.frames().find(f => f.url().includes('/recaptcha/api2/bframe'));
    if (frame) {
      try {
        await frame.locator('table').first().waitFor({ state: 'visible', timeout: 3000 });
        // Wait for tile images to finish loading
        await page.waitForTimeout(1500);
        try {
          await frame.evaluate(async () => {
            const imgs = Array.from(document.querySelectorAll('table img'));
            await Promise.all(imgs.map(img => {
              if (img.complete) return Promise.resolve();
              return new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 3000);
              });
            }));
          });
        } catch {}
        await page.waitForTimeout(500);
        return frame;
      } catch {}
    }
  }
  return null;
}

async function extractGridInfo(frame) {
  return await frame.evaluate(() => {
    const instrEl = document.querySelector('.rc-imageselect-instructions .rc-imageselect-desc-wrapper, .prompt-text');
    const instruction = instrEl ? (instrEl.textContent || '').trim() : '';
    const table = document.querySelector('table');
    const tds = table ? Array.from(table.querySelectorAll('td')) : [];
    const gridSize = tds.length === 9 ? '3x3' : tds.length === 16 ? '4x4' : 'unknown';
    return { instruction, tileCount: tds.length, gridSize };
  });
}

async function screenshotGrid(frame, savePath) {
  // Retry up to 3 times if screenshot is too small (likely blank)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const table = frame.locator('table').first();
      if (await table.count() > 0) {
        await table.screenshot({ path: savePath });
        try {
          const size = statSync(savePath).size;
          if (size > 5000) return true;
          // Too small, probably blank — wait and retry
          console.log(`  screenshot too small (${size} bytes), retrying...`);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        } catch {}
      }
    } catch {}
  }
  // Fallback: full bframe
  try {
    await frame.screenshot({ path: savePath });
    return true;
  } catch {
    return false;
  }
}

async function runManualRound(roundNum) {
  console.log(`\n========== ROUND ${roundNum}/${ROUNDS} ==========`);

  let browser;
  let forwarder = null;
  try {
    const { chromium } = await import('playwright-core');

    const ctxOpts = {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (PROXIES.length > 0) {
      const upstream = PROXIES[proxyIdx % PROXIES.length];
      const localPort = 18100 + (roundNum % 100);
      forwarder = await startProxyForwarder(upstream, localPort);
      ctxOpts.proxy = { server: `http://127.0.0.1:${localPort}` };
      console.log(`Proxy ${proxyIdx % PROXIES.length + 1}/${PROXIES.length}: ${upstream.host}:${upstream.port}`);
      proxyIdx++;
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();

    console.log('Loading reCAPTCHA demo...');
    await page.goto('https://www.google.com/recaptcha/api2/demo', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const anchorFrame = page.frames().find(f => f.url().includes('/recaptcha/api2/anchor'));
    if (anchorFrame) {
      const cb = anchorFrame.locator('#recaptcha-anchor, .recaptcha-checkbox-border').first();
      if (await cb.count() > 0) await cb.click();
    }

    let attempt = 0;
    const maxAttempts = 20;

    while (attempt < maxAttempts) {
      attempt++;
      const frame = await waitForChallengeFrame(page, 15000);
      if (!frame) {
        // Check if verified
        const hasToken = await page.evaluate(() => {
          const el = document.getElementById('g-recaptcha-response');
          return !!(el && el.value && el.value.length > 10);
        });
        if (hasToken) {
          console.log('\n*** CAPTCHA SOLVED! ***\n');
        } else {
          console.log('No challenge appeared and no token. Skipping round.');
        }
        break;
      }

      const info = await extractGridInfo(frame);
      const ssPath = join(screenshotsDir, `round${roundNum}_attempt${attempt}.png`);
      const saved = await screenshotGrid(frame, ssPath);
      if (!saved) {
        console.log('Failed to screenshot grid');
        break;
      }

      // Auto-open screenshot in image viewer (non-blocking)
      openScreenshot(ssPath);

      console.log(`\n--- Round ${roundNum}, Attempt ${attempt} ---`);
      console.log(`Instruction: ${info.instruction}`);
      console.log(`Grid: ${info.gridSize} (${info.tileCount} tiles)`);
      console.log(`Screenshot: ${ssPath}`);
      console.log(`(tiles numbered 0..${info.tileCount - 1}, top-to-bottom left-to-right)`);

      const answer = await ask(`\nEnter tile numbers (comma-separated, e.g. "2,5,6,8"), or "skip", or "done" to end round: `);

      if (answer.toLowerCase() === 'done') break;

      let matchedIndices = [];
      let isSkip = false;
      if (answer.toLowerCase() === 'skip' || answer.toLowerCase() === 's') {
        isSkip = true;
        console.log('Clicking SKIP...');
        try {
          await frame.evaluate(() => {
            const btn = document.querySelector('#recaptcha-verify-button, .rc-button-submit');
            if (btn) btn.click();
          });
        } catch {}
      } else {
        const nums = answer.split(/[,\s]+/).map(s => parseInt(s)).filter(n => !isNaN(n) && n >= 0 && n < info.tileCount);
        matchedIndices = [...new Set(nums)].sort((a, b) => a - b);
        if (matchedIndices.length === 0) {
          console.log('No valid tiles entered, skipping this grid.');
          continue;
        }
        console.log(`\n🎯 Clicking tiles: [${matchedIndices.join(', ')}]`);

        for (const idx of matchedIndices) {
          try {
            // Use Playwright's reliable click on the td element via locator
            const tdLocator = frame.locator('table td').nth(idx);
            await tdLocator.click({ timeout: 3000 });
            await page.waitForTimeout(300 + Math.random() * 300);
          } catch (e) {
            // Fallback: JS click
            try {
              await frame.evaluate((tileIdx) => {
                const tds = document.querySelectorAll('table td');
                if (tds[tileIdx]) {
                  const el = tds[tileIdx];
                  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                  el.click();
                }
              }, idx);
              await page.waitForTimeout(300);
            } catch (e2) {
              console.log(`  ⚠ Failed to click tile ${idx}: ${e.message}`);
            }
          }
        }

        // Click verify button
        console.log('⏳ Clicking verify...');
        await page.waitForTimeout(500);
        try {
          const btnLocator = frame.locator('#recaptcha-verify-button, .rc-button-submit').first();
          if (await btnLocator.count() > 0) {
            await btnLocator.click({ timeout: 3000 });
          } else {
            await frame.evaluate(() => {
              const btn = document.querySelector('#recaptcha-verify-button, .rc-button-submit');
              if (btn) btn.click();
            });
          }
        } catch {}

        // Wait for verification result
        console.log('⌛ Waiting for result...');
        await page.waitForTimeout(3000);
      }

      // Check result
      const result = await checkVerification(page, info.instruction);
      console.log(`\n${'='.repeat(60)}`);
      console.log(`   ${result.message}`);
      console.log(`${'='.repeat(60)}\n`);

      if (result.status === 'SOLVED') {
        stats.solved++;
        stats.success += matchedIndices.length || (isSkip ? 1 : 0);
      } else if (result.status === 'NEW') {
        stats.success += matchedIndices.length || (isSkip ? 1 : 0);
      } else if (result.status === 'WRONG') {
        stats.wrong++;
      }

      console.log(`📊 Stats: ✓ ${stats.success} correct | ✗ ${stats.wrong} wrong | 🏆 ${stats.solved} full solves`);

      // Extract object type from instruction
      let objectType = 'unknown';
      const instrClean = info.instruction.replace(/If there are none.*/i, '').replace(/Click verify.*/i, '').trim();
      const objMatch = instrClean.match(/Select all (?:squares|images) (?:with(?:\s+a)?|that have(?:\s+a)?)\s+(.+)/i);
      if (objMatch) objectType = objMatch[1].trim().toLowerCase();

      // Save training data (even if wrong, so we can analyze mistakes)
      const entry = {
        instruction: instrClean,
        objectType,
        gridSize: info.gridSize,
        gridCount: info.tileCount,
        tileCount: info.tileCount,
        matchedIndices,
        isSkip,
        result: result.status,
        timestamp: Date.now(),
        source: 'manual',
        roundNum,
        attemptNum: attempt,
      };
      trainingData.push(entry);
      writeFileSync(outputFile, JSON.stringify(trainingData, null, 2));

      console.log(`💾 Saved: ${objectType} → [${matchedIndices.join(',')}] (${info.gridSize}) [${isSkip ? 'SKIP' : 'CLICK'}] → ${result.status}`);
      console.log(`💾 Total entries: ${trainingData.length}\n`);

      await page.waitForTimeout(1500);
    }

    await browser.close();
    if (forwarder) forwarder.close();

  } catch (e) {
    console.error(`Round ${roundNum} error: ${e.message}`);
    if (browser) await browser.close().catch(() => {});
    if (forwarder) forwarder.close();
  }
}

(async () => {
  console.log('=== AURIX Captcha Manual Training ===');
  console.log(`Rounds: ${ROUNDS}`);
  console.log(`Proxies: ${PROXIES.length} available`);
  console.log(`Screenshots: ${screenshotsDir}`);
  console.log(`Output: ${outputFile}`);
  console.log('');

  // Auto-open tile numbering reference
  const refPath = join(trainingDir, 'tile-numbering.png');
  if (existsSync(refPath)) {
    console.log(`📖 Opening tile numbering reference...`);
    openScreenshot(refPath);
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('');
  console.log('TIPS:');
  console.log('  ✓ Screenshot grid auto-open di image viewer');
  console.log('  ✓ Reference tile numbering kebuka otomatis');
  console.log('  ✓ Lu pilih tiles, gw auto-click + submit');
  console.log('  ✓ Hasil verification (SUCCESS/FAILED) dikasih tau');
  console.log('');
  console.log('TILE NUMBERING (top-to-bottom, left-to-right):');
  console.log('  3x3: 0 1 2 / 3 4 5 / 6 7 8');
  console.log('  4x4: 0 1 2 3 / 4 5 6 7 / 8 9 10 11 / 12 13 14 15');
  console.log('');
  console.log('INPUT:');
  console.log('  "2,5,6,8"   → pilih tiles 2, 5, 6, 8');
  console.log('  "skip" / "s" → ga ada tile yang cocok');
  console.log('  "done"       → udahan, lanjut round berikutnya');
  console.log('');

  for (let i = 1; i <= ROUNDS; i++) {
    await runManualRound(i);
    if (i < ROUNDS) {
      console.log(`\nWaiting 5s before next round...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('\n=== Training Complete ===');
  console.log(`Total entries: ${trainingData.length}`);
  console.log(`Output: ${outputFile}`);

  const types = {};
  for (const e of trainingData) types[e.objectType] = (types[e.objectType] || 0) + 1;
  console.log('\nObject type distribution:');
  for (const [type, count] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  rl.close();
})();
