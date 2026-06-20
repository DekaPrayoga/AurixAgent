#!/usr/bin/env node

/**
 * AURIX Captcha GUI Training
 * Launches a VISIBLE browser to reCAPTCHA demo.
 * User solves captchas manually in the browser.
 * Script detects success and saves training data automatically.
 *
 * Usage: node scripts/captcha-train-gui.mjs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import http from 'http';
import net from 'net';
import { spawn } from 'child_process';

const projectRoot = '/root/main/aurix-agent';
const trainingDir = join(projectRoot, 'training');
const screenshotsDir = join(trainingDir, 'gui-screenshots');
const outputFile = join(trainingDir, 'captcha-training-gui.json');

if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

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

let trainingData = [];
if (existsSync(outputFile)) {
  try {
    trainingData = JSON.parse(readFileSync(outputFile, 'utf-8'));
    console.log(`Loaded ${trainingData.length} existing entries`);
  } catch {}
}

let stats = { solved: 0, errors: 0 };


(async () => {
  console.log('=== AURIX Captcha GUI Training ===');
  console.log(`Proxies: ${PROXIES.length} available`);
  console.log(`Screenshots: ${screenshotsDir}`);
  console.log(`Output: ${outputFile}`);
  console.log('');
  console.log('INSTRUCTIONS:');
  console.log('  1. Browser kebuka otomatis ke reCAPTCHA demo');
  console.log('  2. Klik checkbox "I\'m not a robot"');
  console.log('  3. Solve captchas manually di browser');
  console.log('  4. Script auto-detect success + save data');
  console.log('  5. Close browser atau Ctrl+C buat udahan');
  console.log('');

  const { chromium } = await import('playwright-core');

  // Browser spawned manually via child_process with DISPLAY=:0

  // Direct connection only (no proxy)
  const proxyCandidates = [null];

  let forwarder = null;
  let browser = null;
  let page = null;
  let chromeProc = null;
  let loadError = null;

  async function killChrome() {
    if (chromeProc && !chromeProc.killed) {
      try { chromeProc.kill('SIGTERM'); } catch {}
      await new Promise(r => setTimeout(r, 1000));
      if (!chromeProc.killed) try { chromeProc.kill('SIGKILL'); } catch {}
    }
    chromeProc = null;
  }

  for (let i = 0; i < proxyCandidates.length; i++) {
    const upstream = proxyCandidates[i];
    if (forwarder) { try { forwarder.close(); } catch {} forwarder = null; }
    await killChrome();

    const chromeArgs = [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-infobars',
      '--password-store=basic',
      '--disable-features=ChromeWhatsNewUI',
      '--window-size=1100,900',
      '--remote-debugging-port=9222',
    ];

    if (upstream) {
      const localPort = 18200 + i;
      try {
        forwarder = await startProxyForwarder(upstream, localPort);
        chromeArgs.push(`--proxy-server=http://127.0.0.1:${localPort}`);
        console.log(`Attempt ${i + 1}/${proxyCandidates.length} with proxy: ${upstream.host}:${upstream.port}`);
      } catch (e) {
        console.log(`  proxy forwarder failed: ${e.message}, trying next...`);
        continue;
      }
    } else {
      console.log(`Attempt ${i + 1}/${proxyCandidates.length} WITHOUT proxy (direct)`);
    }

    chromeArgs.push('about:blank');

    console.log(`Spawning chromium on DISPLAY=:0...`);
    try {
      chromeProc = spawn('/usr/bin/chromium', chromeArgs, {
        env: { ...process.env, DISPLAY: ':0', XAUTHORITY: '/var/run/lightdm/root/:0' },
        detached: false,
        stdio: 'ignore',
      });

      chromeProc.on('exit', (code) => {
        console.log(`  chromium exited with code ${code}`);
      });

      // Wait for CDP to be ready
      await new Promise(r => setTimeout(r, 3000));

      browser = await chromium.connectOverCDP({ endpointURL: 'http://127.0.0.1:9222' });
      const contexts = browser.contexts();
      const context = contexts[0];

      // Set up auth dialog handler on existing pages and future pages
      context.on('page', (p) => {
        p.on('dialog', async (dialog) => {
          console.log(`  auto-dismissing dialog: ${dialog.type()} "${dialog.message().substring(0, 60)}"`);
          try { await dialog.accept('root'); } catch {}
        });
      });

      page = context.pages()[0] || await context.newPage();

      page.on('dialog', async (dialog) => {
        console.log(`  auto-filling dialog: ${dialog.type()} "${dialog.message().substring(0, 60)}"`);
        try { await dialog.accept('root'); } catch {}
      });

      console.log('Navigating to reCAPTCHA demo...');
      await page.goto('https://www.google.com/recaptcha/api2/demo', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      loadError = null;
      console.log(`Proxy: ${upstream ? upstream.host + ':' + upstream.port : 'DIRECT'}`);
      break;
    } catch (e) {
      loadError = e;
      console.log(`  ✗ ${e.message.split('\n')[0]}`);
      if (browser) { try { await browser.close(); } catch {} browser = null; }
      await killChrome();
      if (i < proxyCandidates.length - 1) console.log('  trying next proxy...');
    }
  }

  if (!browser || !page || loadError) {
    console.error(`\nFailed to load reCAPTCHA demo after ${proxyCandidates.length} attempts.`);
    if (forwarder) forwarder.close();
    await killChrome();
    process.exit(1);
  }

  console.log('\n✓ Browser ready! Solve captchas di browser.');
  console.log('  (script auto-save setiap successful solve)\n');

  // === Unified monitor: tracks challenges, selections, and solves ===
  const WIB = 7 * 3600000;
  const wibNow = () => new Date(Date.now() + WIB).toISOString().replace('T', ' ').substring(11, 19);

  let lastToken = '';
  let roundNum = 0;
  let challengeNum = 0;
  let lastInstruction = '';
  let hasGrid = false;
  let pendingByChallenge = {};
  let tryAgainCooldown = 0;
  let currentObjectType = '';
  let currentGridSize = '';
  let currentTileCount = 0;

  const monitor = setInterval(async () => {
    try {
      // Check for solve token
      const token = await page.evaluate(() => {
        const el = document.getElementById('g-recaptcha-response');
        return el ? el.value : '';
      });

      if (token && token.length > 10 && token !== lastToken) {
        lastToken = token;
        roundNum++;
        stats.solved++;

        const correctEntries = Object.values(pendingByChallenge).filter(Boolean);
        for (const entry of correctEntries) {
          entry.correct = true;
          entry.roundNum = roundNum;
        }
        trainingData.push(...correctEntries);
        writeFileSync(outputFile, JSON.stringify(trainingData, null, 2));

        const correctCount = trainingData.filter(e => e.correct === true).length;
        const wrongCount = trainingData.filter(e => e.correct === false).length;
        console.log(`\n  [${wibNow()}] SOLVE #${stats.solved}! ${correctEntries.length} correct entries saved`);
        console.log(`  [${wibNow()}] Total: ${trainingData.length} entries (${correctCount} correct, ${wrongCount} wrong)\n`);

        pendingByChallenge = {};
        lastInstruction = '';
        challengeNum = 0;
        hasGrid = false;
        tryAgainCooldown = 0;
        currentObjectType = '';
      }

      // Check bframe for grid state + "Please Try Again"
      const bframe = page.frames().find(f => f.url().includes('/recaptcha/api2/bframe'));
      if (!bframe) return;

      const state = await bframe.evaluate(() => {
        const instrEl = document.querySelector('.rc-imageselect-instructions .rc-imageselect-desc-wrapper, .prompt-text');
        const instruction = instrEl ? (instrEl.textContent || '').trim() : '';
        const tryAgainEl = document.querySelector('.rc-imageselect-error, .rc-imageselect-incorrect');
        const tryAgainVisible = tryAgainEl && tryAgainEl.offsetParent !== null;
        const tryAgain = tryAgainVisible || (tryAgainEl && /please\s*try\s*again/i.test(tryAgainEl.textContent));
        const table = document.querySelector('table');
        if (!table) return { instruction, hasGrid: false, tryAgain };
        const tds = Array.from(table.querySelectorAll('td'));
        const selectedIndices = [];
        tds.forEach((td, idx) => {
          const inner = td.querySelector('[class]');
          const cls = (td.className || '') + ' ' + (inner ? inner.className : '');
          const checked = td.getAttribute('aria-checked') === 'true' ||
            (inner && inner.getAttribute('aria-checked') === 'true');
          if (checked || /selected/i.test(cls)) selectedIndices.push(idx);
        });
        return {
          instruction,
          hasGrid: true,
          tileCount: tds.length,
          gridSize: tds.length === 9 ? '3x3' : tds.length === 16 ? '4x4' : 'unknown',
          selectedIndices,
          tryAgain,
        };
      });

      // Detect "Please Try Again" → WRONG
      // ONLY if: cooldown expired AND user actually selected tiles for this challenge
      if (tryAgainCooldown > 0) tryAgainCooldown--;
      const hasAnswered = pendingByChallenge[challengeNum] &&
        pendingByChallenge[challengeNum].selectedIndices.length > 0;
      if (state.tryAgain && tryAgainCooldown === 0 && hasAnswered) {
        tryAgainCooldown = 12; // 3 second cooldown (12 x 250ms)
        const entry = pendingByChallenge[challengeNum];
        entry.correct = false;
        entry.roundNum = roundNum;
        trainingData.push(entry);
        writeFileSync(outputFile, JSON.stringify(trainingData, null, 2));

        const correctCount = trainingData.filter(e => e.correct === true).length;
        const wrongCount = trainingData.filter(e => e.correct === false).length;
        console.log(`    [${wibNow()}] ✗ WRONG! ${entry.objectType} (${entry.gridSize}) tiles: [${entry.selectedIndices.join(', ')}]`);
        console.log(`    [${wibNow()}] Total: ${trainingData.length} (${correctCount} correct, ${wrongCount} wrong)`);

        delete pendingByChallenge[challengeNum];
      }

      // Detect new challenge
      if (state.hasGrid && state.instruction && state.instruction.includes('Select all')) {
        if (state.instruction !== lastInstruction) {
          challengeNum++;
          lastInstruction = state.instruction;
          hasGrid = true;

          currentObjectType = (state.instruction.match(/Select all (?:images|squares) with (.+?)(?:Click|If|$)/i) || [])[1] || 'unknown';
          currentObjectType = currentObjectType.trim();
          currentGridSize = state.gridSize;
          currentTileCount = state.tileCount;

          // Screenshot empty grid immediately
          let emptySsPath = '';
          try {
            emptySsPath = join(screenshotsDir, `c${challengeNum}_grid_${Date.now()}.png`);
            const table = bframe.locator('table').first();
            if (await table.count() > 0) {
              await table.screenshot({ path: emptySsPath });
            }
          } catch { emptySsPath = ''; }

          // Create pending entry IMMEDIATELY so it's never lost
          pendingByChallenge[challengeNum] = {
            timestamp: Date.now(),
            source: 'gui',
            objectType: currentObjectType,
            gridSize: currentGridSize,
            tileCount: currentTileCount,
            selectedIndices: [],
            instruction: state.instruction.substring(0, 100),
            screenshot: emptySsPath,
            correct: null,
            challengeNum,
          };

          console.log(`  [${wibNow()}] Challenge #${challengeNum}: "${currentObjectType}" (${state.gridSize})`);
        }

        // Update with selected tiles when detected
        if (state.selectedIndices.length > 0) {
          const selKey = JSON.stringify(state.selectedIndices);
          const prev = pendingByChallenge[challengeNum];
          const prevKey = prev ? JSON.stringify(prev.selectedIndices) : '[]';

          if (selKey !== prevKey) {
            const ssPath = join(screenshotsDir, `c${challengeNum}_sel_${Date.now()}.png`);
            try {
              const table = bframe.locator('table').first();
              if (await table.count() > 0) {
                await table.screenshot({ path: ssPath });
                if (pendingByChallenge[challengeNum]) {
                  pendingByChallenge[challengeNum].screenshot = ssPath;
                }
              }
            } catch {}

            if (pendingByChallenge[challengeNum]) {
              pendingByChallenge[challengeNum].selectedIndices = state.selectedIndices;
              pendingByChallenge[challengeNum].timestamp = Date.now();
            }
          }
        }
      } else if (!state.hasGrid && hasGrid) {
        hasGrid = false;
      }
    } catch (e) {
      if (e.message && /closed|destroyed|disconnect/i.test(e.message)) {
        clearInterval(monitor);
      }
    }
  }, 250);

  // Wait for browser to close
  await new Promise((resolve) => {
    browser.on('disconnected', () => {
      console.log('\n\nBrowser closed.');
      clearInterval(monitor);
      resolve();
    });
  });

  if (forwarder) forwarder.close();
  await killChrome();

  console.log('\n=== Training Session Complete ===');
  console.log(`🏆 Total solves: ${stats.solved}`);
  console.log(`💾 Total entries: ${trainingData.length}`);
  console.log(`📁 Output: ${outputFile}`);
})();
