#!/usr/bin/env node

/**
 * AURIX Captcha Training Automation
 * Runs full captcha solving rounds and saves training data.
 * Usage: node scripts/captcha-train.mjs [rounds]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import http from 'http';
import net from 'net';

const projectRoot = '/root/main/aurix-agent';
const trainingDir = join(projectRoot, 'training');
const outputFile = join(trainingDir, 'captcha-training.json');
const debugLog = '/tmp/captcha-debug.log';

const ROUNDS = parseInt(process.argv[2] || '10');
const BASE_URL = process.env.AURIX_BASE_URL || 'http://127.0.0.1:20128/v1';
const MODEL = process.env.AURIX_MODEL || 'ag/gemini-3-flash';
const VISION_MODEL = process.env.AURIX_VISION_MODEL || 'ag/gemini-pro-agent';
const API_KEY = process.env.AURIX_API_KEY || 'sk-7002034586af809a-wlmjyn-41fd59d6';
const SOLVE_TIMEOUT = 300_000;

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

process.env.AURIX_BASE_URL = BASE_URL;
process.env.AURIX_MODEL = MODEL;
process.env.AURIX_API_KEY = API_KEY;
process.env.AURIX_VISION_BASE_URL = BASE_URL;
process.env.AURIX_VISION_MODEL = VISION_MODEL;
process.env.AURIX_VISION_API_KEY = API_KEY;

console.log('=== AURIX Captcha Training ===');
console.log(`Rounds: ${ROUNDS}`);
console.log(`Model: ${MODEL}`);
console.log(`Base URL: ${BASE_URL}`);
console.log(`Solve timeout: ${SOLVE_TIMEOUT / 1000}s per round`);
console.log(`Proxies: ${PROXIES.length} available`);
console.log(`Output: ${outputFile}`);
console.log('');

if (!existsSync(trainingDir)) {
  mkdirSync(trainingDir, { recursive: true });
}

let trainingData = [];
if (existsSync(outputFile)) {
  try {
    trainingData = JSON.parse(readFileSync(outputFile, 'utf-8'));
    console.log(`Loaded ${trainingData.length} existing entries`);
  } catch {
    console.log('Starting fresh (could not parse existing file)');
  }
}

function parseDebugLog(roundMarker) {
  if (!existsSync(debugLog)) return null;
  const content = readFileSync(debugLog, 'utf-8');
  const startIdx = content.lastIndexOf(roundMarker);
  if (startIdx < 0) return null;
  const section = content.substring(startIdx);
  const lines = section.split('\n');

  let instruction = '', objectType = 'unknown', gridSize = '3x3', gridCount = 9, tileCount = 9;
  let matchedIndices = [];

  for (const line of lines) {
    const instrMatch = line.match(/instruction:\s*"([^"]+)"/);
    if (instrMatch && !instruction) {
      instruction = instrMatch[1].replace(/If there are none.*$/i, '').replace(/Click verify once.*$/i, '').trim();
      const objMatch = instruction.match(/Select all (?:squares|images) with(?:\s+a)?\s+(.+)/i);
      if (objMatch) objectType = objMatch[1].trim();
    }
    const gridMatch = line.match(/grid layout:\s*(\d+)x(\d+)\s*\((\d+)/);
    if (gridMatch) { gridSize = `${gridMatch[1]}x${gridMatch[2]}`; gridCount = parseInt(gridMatch[3]); tileCount = gridCount; }
    const tileMatch = line.match(/found (\d+) tiles/);
    if (tileMatch) tileCount = parseInt(tileMatch[1]);
    const matchedMatch = line.match(/parsed matched indices:\s*\[([^\]]+)\]/);
    if (matchedMatch) matchedIndices = matchedMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  }

  let solved = false;
  for (const line of lines) {
    if (/CAPTCHA SOLVED/i.test(line)) solved = true;
  }

  return { instruction, objectType, gridSize, gridCount, tileCount, matchedIndices, visionResponse: section.substring(0, 2000), solved };
}

function parseDebugLogAll(roundMarker) {
  if (!existsSync(debugLog)) return [];
  const content = readFileSync(debugLog, 'utf-8');
  const roundStart = content.indexOf(roundMarker);
  if (roundStart < 0) return [];

  const roundSection = content.substring(roundStart);
  const attemptMarkers = [...roundSection.matchAll(/=== ROUND \d+ START === attempt=(\d+)/g)];
  if (attemptMarkers.length === 0) {
    const single = parseDebugLog(roundMarker);
    return single ? [single] : [];
  }

  const results = [];
  for (let i = 0; i < attemptMarkers.length; i++) {
    const start = attemptMarkers[i].index;
    const end = i + 1 < attemptMarkers.length ? attemptMarkers[i + 1].index : roundSection.length;
    const section = roundSection.substring(start, end);
    const lines = section.split('\n');

    let instruction = '', objectType = 'unknown', gridSize = '3x3', gridCount = 9, tileCount = 9;
    let matchedIndices = [];

    for (const line of lines) {
      const instrMatch = line.match(/instruction:\s*"([^"]+)"/);
      if (instrMatch && !instruction) {
        instruction = instrMatch[1].replace(/If there are none.*$/i, '').replace(/Click verify once.*$/i, '').trim();
        const objMatch = instruction.match(/Select all (?:squares|images) with(?:\s+a)?\s+(.+)/i);
        if (objMatch) objectType = objMatch[1].trim();
      }
      const gridMatch = line.match(/grid layout:\s*(\d+)x(\d+)\s*\((\d+)/);
      if (gridMatch) { gridSize = `${gridMatch[1]}x${gridMatch[2]}`; gridCount = parseInt(gridMatch[3]); tileCount = gridCount; }
      const tileMatch = line.match(/found (\d+) tiles/);
      if (tileMatch) tileCount = parseInt(tileMatch[1]);
      const matchedMatch = line.match(/parsed matched indices:\s*\[([^\]]+)\]/);
      if (matchedMatch) matchedIndices = matchedMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    }

    if (instruction && matchedIndices.length > 0) {
      results.push({ instruction, objectType, gridSize, gridCount, tileCount, matchedIndices });
    }
  }
  return results;
}

async function checkVerified(page) {
  let hasToken = false;
  try {
    hasToken = await page.evaluate(() => {
      const el = document.getElementById('g-recaptcha-response');
      return !!(el && el.value && el.value.length > 10);
    });
  } catch {}

  let ariaChecked = false;
  try {
    for (const f of page.frames()) {
      if (f.url().includes('/recaptcha/') && f.url().includes('/anchor')) {
        const anchor = f.locator('#recaptcha-anchor[aria-checked="true"]');
        if (await anchor.count() > 0) { ariaChecked = true; break; }
      }
    }
  } catch {}

  return { hasToken, ariaChecked, verified: hasToken || ariaChecked };
}

async function waitForChallengeFrame(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(1000);
    const frame = page.frames().find(f => f.url().includes('/recaptcha/api2/bframe'));
    if (frame) {
      try {
        await frame.locator('.rc-imageselect-instructions, .prompt-text, table').first().waitFor({ state: 'visible', timeout: 3000 });
        return frame;
      } catch {}
    }
  }
  return null;
}

async function runTrainingRound(roundNum) {
  console.log(`\n--- Round ${roundNum}/${ROUNDS} ---`);

  const roundMarker = `=== ROUND ${roundNum} START ===`;
  try { appendFileSync(debugLog, `\n${roundMarker}\n`); } catch {}

  let browser;
  let forwarder = null;
  try {
    const { chromium } = await import('playwright-core');
    const { solveCaptchaGrid } = await import('../dist/tools/captcha/RecaptchaSolver.js');

    console.log('Launching browser...');

    const ctxOpts = {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (PROXIES.length > 0) {
      const upstream = PROXIES[proxyIdx % PROXIES.length];
      const localPort = 18080 + (roundNum % 100);
      forwarder = await startProxyForwarder(upstream, localPort);
      ctxOpts.proxy = { server: `http://127.0.0.1:${localPort}` };
      console.log(`Proxy ${proxyIdx % PROXIES.length + 1}/${PROXIES.length}: ${upstream.host}:${upstream.port} → :${localPort}`);
      proxyIdx++;
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();

    console.log('Navigating to reCAPTCHA demo...');
    await page.goto('https://www.google.com/recaptcha/api2/demo', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Click the anchor checkbox
    const allFrames = page.frames();
    console.log(`Found ${allFrames.length} frames`);

    const anchorFrame = allFrames.find(f => f.url().includes('/recaptcha/api2/anchor'));
    if (anchorFrame) {
      const checkbox = anchorFrame.locator('#recaptcha-anchor, .recaptcha-checkbox-border').first();
      if (await checkbox.count() > 0) {
        await checkbox.click();
        console.log('Clicked checkbox');
      }
    }

    // Wait for first challenge
    console.log('Waiting for challenge (up to 15s)...');
    let challengeFrame = await waitForChallengeFrame(page);
    if (!challengeFrame) {
      // Check if auto-verified (no challenge needed)
      const v = await checkVerified(page);
      if (v.verified) {
        console.log(`✓ Round ${roundNum}: auto-verified (no challenge)`);
      } else {
        console.log('✗ No challenge appeared and not verified');
      }
      await browser.close();
      if (forwarder) forwarder.close();
      return;
    }
    console.log('Challenge loaded');

    // Loop: solve challenges until verified or failed
    const maxAttempts = 10;
    let attempt = 0;
    let verified = false;

    while (attempt < maxAttempts) {
      attempt++;
      const marker = `${roundMarker} attempt=${attempt}`;
      try { appendFileSync(debugLog, `\n${marker}\n`); } catch {}

      console.log(`  Attempt ${attempt}: running solver...`);
      const solvePromise = solveCaptchaGrid(page, challengeFrame, 'recaptcha');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Solver timeout')), SOLVE_TIMEOUT));

      let result;
      try {
        result = await Promise.race([solvePromise, timeoutPromise]);
      } catch (e) {
        console.log(`  Solver error: ${e.message}`);
        break;
      }

      const lastLine = result.split('\n').pop() || '';
      console.log(`  Result: ${lastLine}`);

      if (/\[VERIFIED\]/.test(result)) {
        // Solver says verified — double check the page
        const v = await checkVerified(page);
        if (v.verified) {
          verified = true;
          console.log(`  ✓ VERIFIED (token=${v.hasToken}, aria=${v.ariaChecked})`);
          break;
        } else {
          console.log(`  Solver says verified but page doesn't confirm, checking bframe...`);
          // Maybe bframe already gone
          const hasBframe = page.frames().some(f => f.url().includes('/recaptcha/api2/bframe'));
          if (!hasBframe) {
            verified = true;
            console.log(`  ✓ VERIFIED (bframe gone)`);
            break;
          }
        }
      }

      if (/\[BFRAME_GONE\]/.test(result)) {
        const v = await checkVerified(page);
        verified = v.verified;
        console.log(`  ${verified ? '✓' : '?'} bframe gone, verified=${verified}`);
        break;
      }

      if (/\[FAILED\]|\[SAME_CHALLENGE\]/.test(result)) {
        console.log(`  ✗ Answer was wrong`);
        break;
      }

      if (/\[NEW_CHALLENGE\]/.test(result)) {
        console.log(`  New challenge appeared, solving next grid...`);
        await page.waitForTimeout(2000);
        challengeFrame = await waitForChallengeFrame(page, 10000);
        if (!challengeFrame) {
          // Maybe verified already
          const v = await checkVerified(page);
          verified = v.verified;
          console.log(`  ${verified ? '✓' : '?'} No new bframe, verified=${verified}`);
          break;
        }
        continue;
      }

      // Unknown result — check page state
      const v = await checkVerified(page);
      if (v.verified) {
        verified = true;
        console.log(`  ✓ VERIFIED (detected from page)`);
        break;
      }

      const hasBframe = page.frames().some(f => f.url().includes('/recaptcha/api2/bframe'));
      if (!hasBframe) {
        verified = true;
        console.log(`  ✓ VERIFIED (bframe gone)`);
        break;
      }

      console.log(`  Unknown state, stopping`);
      break;
    }

    if (verified) {
      console.log(`✓ Round ${roundNum}: CAPTCHA SOLVED (${attempt} attempt${attempt > 1 ? 's' : ''})`);
      // Save training data from all attempts in this round
      const allParsed = parseDebugLogAll(roundMarker);
      let savedCount = 0;
      for (const parsed of allParsed) {
        if (!parsed.instruction || parsed.matchedIndices.length === 0) continue;
        const exists = trainingData.some(t =>
          t.objectType?.toLowerCase() === parsed.objectType.toLowerCase() &&
          t.gridSize === parsed.gridSize &&
          JSON.stringify(t.matchedIndices) === JSON.stringify(parsed.matchedIndices)
        );
        if (!exists) {
          trainingData.push({
            instruction: parsed.instruction,
            objectType: parsed.objectType,
            gridSize: parsed.gridSize,
            gridCount: parsed.gridCount,
            tileCount: parsed.tileCount,
            matchedIndices: parsed.matchedIndices,
            timestamp: Date.now(),
            successCount: 1
          });
          console.log(`  + NEW "${parsed.objectType}" → [${parsed.matchedIndices.join(',')}] (${parsed.gridSize})`);
          savedCount++;
        } else {
          const entry = trainingData.find(t =>
            t.objectType?.toLowerCase() === parsed.objectType.toLowerCase() &&
            JSON.stringify(t.matchedIndices) === JSON.stringify(parsed.matchedIndices)
          );
          if (entry) entry.successCount = (entry.successCount || 1) + 1;
          console.log(`  + DUP "${parsed.objectType}" (sc=${entry?.successCount})`);
          savedCount++;
        }
      }
      if (savedCount === 0) console.log(`  (no parseable training data from debug log)`);
    } else {
      console.log(`✗ Round ${roundNum}: FAILED after ${attempt} attempt${attempt > 1 ? 's' : ''}`);
    }

    await browser.close();
    if (forwarder) forwarder.close();

  } catch (e) {
    console.error(`✗ Round ${roundNum} error: ${e.message}`);
    if (browser) await browser.close().catch(() => {});
    if (forwarder) forwarder.close();
  }

  writeFileSync(outputFile, JSON.stringify(trainingData, null, 2));
  console.log(`Saved ${trainingData.length} entries`);
}

// Run all rounds
(async () => {
  for (let i = 1; i <= ROUNDS; i++) {
    await runTrainingRound(i);

    if (i < ROUNDS) {
      const waitSec = 10;
      console.log(`Waiting ${waitSec}s before next round...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
  }

  console.log('\n=== Training Complete ===');
  console.log(`Total entries: ${trainingData.length}`);
  console.log(`Output: ${outputFile}`);

  // Print summary
  const types = {};
  for (const e of trainingData) {
    types[e.objectType] = (types[e.objectType] || 0) + 1;
  }
  console.log('\nObject type distribution:');
  for (const [type, count] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
})();
