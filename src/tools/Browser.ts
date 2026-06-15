import { type BrowserContext, type Page } from 'playwright-core';
import { launchPersistentContext, ensureBinary } from 'cloakbrowser';
import { homedir } from 'os';
import { join } from 'path';
import { readdirSync, readFileSync, unlinkSync } from 'fs';
import type { Tool } from './Registry.js';
import { loadConfig } from '../agent/Config.js';

function ok(msg: string, details?: Record<string, string>): string {
  const lines = [`[OK] ${msg}`];
  if (details) for (const [k, v] of Object.entries(details)) lines.push(`  ${k}: ${v}`);
  return lines.join('\n');
}

function err(msg: string, suggestion?: string): string {
  const lines = [`[ERROR] ${msg}`];
  if (suggestion) lines.push(`  fix: ${suggestion}`);
  return lines.join('\n');
}

function warn(msg: string, details?: Record<string, string>): string {
  const lines = [`[WARN] ${msg}`];
  if (details) for (const [k, v] of Object.entries(details)) lines.push(`  ${k}: ${v}`);
  return lines.join('\n');
}

let _lastActionScreenshot = '';
async function autoScreenshot(p: Page, label: string): Promise<string> {
  const path = join(homedir(), '.aurix-last-action.png');
  try { await p.screenshot({ path }); _lastActionScreenshot = path; } catch {}
  return path;
}

// ─── Vision-Based Captcha Auto-Solve ──────────────────────────────────────

let _lastGridAnalyzeTime = 0;

function readFileBase64(path: string): string {
  return readFileSync(path).toString('base64');
}

async function visionClassify(imageBase64: string, prompt: string): Promise<string> {
  const config = loadConfig();
  const model = config.model || 'gpt-4o';
  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
      ],
    }],
    max_tokens: 100,
  };

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`Vision API error: ${resp.status}`);

  const text = await resp.text();

  if (text.includes('data: ')) {
    let content = '';
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
        try {
          const ev = JSON.parse(line.slice(6));
          const delta = ev.choices?.[0]?.delta;
          if (delta?.content) content += delta.content;
          if (delta?.text) content += delta.text;
          if (ev.choices?.[0]?.message?.content) content += ev.choices[0].message.content;
        } catch {}
      }
    }
    return content.trim();
  }

  const json = JSON.parse(text);
  return (json.choices?.[0]?.message?.content || '').trim();
}

async function solveCaptchaGrid(page: any, frame: any, provider: string): Promise<string> {
  const results: string[] = [];
  const isRecaptcha = provider === 'recaptcha';

  let instruction = '';
  try {
    const instrEl = frame.locator('.rc-imageselect-instructions, .prompt-text, .prompt-text-h, .geetest_tip_content, .mtcaptcha-label');
    if (await instrEl.count() > 0) {
      instruction = (await instrEl.first().textContent() || '').trim();
    }
    if (!instruction) {
      const strongText = frame.locator('strong').first();
      if (await strongText.count() > 0) instruction = (await strongText.textContent() || '').trim();
    }
  } catch {}

  if (!instruction) {
    results.push('[WARN] Could not extract captcha instruction, cannot auto-solve');
    return results.join('\n');
  }

  results.push(`Auto-solving: "${instruction}"`);

  try {
    const home = homedir();
    for (const f of readdirSync(home)) {
      if (/^\.aurix-tile-(\d+|after-\d+)\.png$/.test(f)) {
        try { unlinkSync(join(home, f)); } catch {}
      }
    }
  } catch {}

  const tiles = await findGridTiles(frame, provider);
  const gridScreenshotPath = join(homedir(), '.aurix-captcha-grid.png');
  try {
    const gridEl = frame.locator('.rc-imageselect-table-33, .rc-imageselect-table-44, .task, .challenge-view, table').first();
    if (await gridEl.count() > 0) await gridEl.screenshot({ path: gridScreenshotPath });
    else await frame.locator('body').screenshot({ path: gridScreenshotPath });
  } catch {
    try { await page.screenshot({ path: gridScreenshotPath }); } catch {}
  }

  for (let i = 0; i < tiles.length; i++) {
    try { await tiles[i].screenshot({ path: join(homedir(), `.aurix-tile-${i}.png`) }); } catch {}
  }

  const classifyPrompt = `Look at this captcha grid image. The instruction is: "${instruction}". Which tile images match this instruction? Reply with ONLY the 0-based indices separated by commas (e.g. "0,3,5"). If none match, reply "none".`;

  let matchedIndices: number[] = [];
  try {
    const gridBase64 = readFileBase64(gridScreenshotPath);
    const response = await visionClassify(gridBase64, classifyPrompt);
    results.push(`Vision model: "${response}"`);

    if (response.toLowerCase().includes('none')) {
      results.push('Vision: no matching tiles, clicking verify directly');
    } else {
      matchedIndices = response.split(',')
        .map(s => parseInt(s.trim()))
        .filter(n => !isNaN(n) && n >= 0 && n < tiles.length);
    }
  } catch (e: any) {
    results.push(`[WARN] Vision model failed: ${e.message}`);
    results.push('Auto-solve requires a vision-capable model. Falling back to manual mode.');
    results.push('Use "captcha-grid" to see tiles and "click-tile" to select them manually.');
    return results.join('\n');
  }

  if (matchedIndices.length === 0) {
    results.push('No matching tiles found, attempting verify directly');
  }

  for (const idx of matchedIndices) {
    try {
      const currentTiles = await findGridTiles(frame, provider);
      if (idx >= currentTiles.length) continue;
      const tile = currentTiles[idx];
      const tileBox = await tile.boundingBox();
      if (tileBox) {
        const cx = tileBox.x + tileBox.width * (0.3 + Math.random() * 0.4);
        const cy = tileBox.y + tileBox.height * (0.3 + Math.random() * 0.4);
        await humanMove(cx, cy, page);
        await page.waitForTimeout(80 + Math.random() * 120);
        await page.mouse.down();
        await page.waitForTimeout(60 + Math.random() * 100);
        await page.mouse.up();
      } else {
        await tile.click({ force: true });
      }
      results.push(`  Clicked tile ${idx}`);
    } catch (e: any) {
      results.push(`  Failed to click tile ${idx}: ${e.message}`);
    }
  }

  if (isRecaptcha && matchedIndices.length > 0) {
    await page.waitForTimeout(2000 + Math.random() * 1000);

    const afterTiles = await findGridTiles(frame, provider);
    const evalPromises = matchedIndices
      .filter(idx => idx < afterTiles.length)
      .map(async (idx) => {
        try {
          const tilePath = join(homedir(), `.aurix-tile-after-${idx}.png`);
          await afterTiles[idx].screenshot({ path: tilePath });
          const base64 = readFileBase64(tilePath);
          const resp = await visionClassify(base64, `Does this image contain ${instruction}? Reply YES or NO only.`);
          return { idx, match: resp.toLowerCase().includes('yes') };
        } catch {
          return { idx, match: false };
        }
      });

    const evalResults = await Promise.all(evalPromises);
    const newMatches = evalResults.filter(r => r.match);

    if (newMatches.length > 0) {
      results.push(`  Replacement tiles matched: [${newMatches.map(r => r.idx).join(', ')}]`);
      for (const { idx } of newMatches) {
        try {
          const freshTiles = await findGridTiles(frame, provider);
          if (idx >= freshTiles.length) continue;
          const tile = freshTiles[idx];
          const tileBox = await tile.boundingBox();
          if (tileBox) {
            const cx = tileBox.x + tileBox.width * (0.3 + Math.random() * 0.4);
            const cy = tileBox.y + tileBox.height * (0.3 + Math.random() * 0.4);
            await humanMove(cx, cy, page);
            await page.waitForTimeout(80 + Math.random() * 120);
            await page.mouse.down();
            await page.waitForTimeout(60 + Math.random() * 100);
            await page.mouse.up();
          } else {
            await tile.click({ force: true });
          }
          results.push(`  Clicked replacement tile ${idx}`);
        } catch (e: any) {
          results.push(`  Failed replacement tile ${idx}: ${e.message}`);
        }
      }
      await page.waitForTimeout(1500 + Math.random() * 1000);
    } else {
      results.push('  No replacement tiles matched');
    }
  }

  results.push('Clicking verify...');
  try {
    let verifyBtn = frame.locator('#recaptcha-verify-button, .rc-button-submit, .button-submit, [id*="verify"]');
    if (await verifyBtn.count() === 0) {
      verifyBtn = frame.locator('button:has-text("Verify"), button:has-text("Next"), button:has-text("Submit")');
    }

    if (await verifyBtn.count() > 0) {
      await humanClick(verifyBtn, page);
      await page.waitForTimeout(3000);

      const errorText = await frame.locator('.rc-imageselect-incorrect-response, .error-message, .incorrect').count();
      if (errorText > 0) {
        results.push('Verification failed, challenge will retry');
        return results.join('\n');
      }

      const newChallenge = await frame.locator('.rc-imageselect-instructions, .prompt-text').count();
      if (newChallenge > 0) {
        const newInstr = (await frame.locator('.rc-imageselect-instructions, .prompt-text').first().textContent() || '').trim();
        if (newInstr !== instruction) {
          results.push(`New challenge appeared: "${newInstr}"`);
          return results.join('\n');
        }
        results.push('Same challenge still present');
        return results.join('\n');
      }

      const verifyResultPath = join(homedir(), '.aurix-captcha-verify-result.png');
      await page.screenshot({ path: verifyResultPath }).catch(() => {});
      results.push(`[OK] Captcha solved! Screenshot: ${verifyResultPath}`);
      return results.join('\n');
    } else {
      results.push('[WARN] No verify button found');
      return results.join('\n');
    }
  } catch (e: any) {
    results.push(`Verify failed: ${e.message}`);
    return results.join('\n');
  }
}

// ─── Human-Like Mouse Utilities ────────────────────────────────────────────

function bezierPoint(t: number, points: [number, number][]): [number, number] {
  if (points.length === 1) return points[0];
  const next: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    next.push([
      points[i][0] + (points[i + 1][0] - points[i][0]) * t,
      points[i][1] + (points[i + 1][1] - points[i][1]) * t,
    ]);
  }
  return bezierPoint(t, next);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

async function humanMove(x: number, y: number, page: Page): Promise<void> {
  const mouse = page.mouse;
  const vp = page.viewportSize() || { width: 1280, height: 720 };

  // Start from a random position if we don't know current pos
  const startX = Math.random() * vp.width * 0.3;
  const startY = Math.random() * vp.height * 0.3;

  // Generate 2-4 control points for bezier curve
  const numControls = 2 + Math.floor(Math.random() * 3);
  const controlPoints: [number, number][] = [[startX, startY]];
  for (let i = 0; i < numControls; i++) {
    const frac = (i + 1) / (numControls + 1);
    const cx = startX + (x - startX) * frac + (Math.random() - 0.5) * 80;
    const cy = startY + (y - startY) * frac + (Math.random() - 0.5) * 60;
    controlPoints.push([cx, cy]);
  }
  controlPoints.push([x, y]);

  // Step through the curve with eased timing
  const totalSteps = 25 + Math.floor(Math.random() * 20);
  for (let step = 0; step <= totalSteps; step++) {
    const rawT = step / totalSteps;
    const t = easeInOut(rawT);
    const [px, py] = bezierPoint(t, controlPoints);

    // Sine-wave micro-tremor (not uniform random)
    const tremor = Math.sin(step * 0.3 + Math.random() * 0.5) * 0.4;
    const tremorY = Math.cos(step * 0.25 + Math.random() * 0.5) * 0.3;

    await mouse.move(px + tremor, py + tremorY);

    // Variable step delay: faster in middle, slower at start/end
    const speedFactor = 1 - Math.abs(rawT - 0.5) * 2;
    const delay = 8 + Math.random() * 12 + speedFactor * 5;
    await page.waitForTimeout(delay);
  }

  // Occasional overshoot + correction
  if (Math.random() > 0.6) {
    const overX = x + (Math.random() - 0.5) * 8;
    const overY = y + (Math.random() - 0.5) * 8;
    await mouse.move(overX, overY);
    await page.waitForTimeout(30 + Math.random() * 40);
    await mouse.move(x, y);
    await page.waitForTimeout(20 + Math.random() * 30);
  }
}

let lastWarmupTime = 0;

async function warmupBehavior(page: Page): Promise<void> {
  const now = Date.now();
  if (now - lastWarmupTime < 30000) return;
  lastWarmupTime = now;

  const vp = page.viewportSize() || { width: 1280, height: 720 };
  const spots = 1 + Math.floor(Math.random() * 2);

  for (let i = 0; i < spots; i++) {
    const rx = Math.random() * vp.width;
    const ry = Math.random() * vp.height;
    await humanMove(rx, ry, page);
    await page.waitForTimeout(150 + Math.random() * 300);
  }

  if (Math.random() > 0.5) {
    const scrollDelta = Math.floor(Math.random() * 150) - 75;
    await page.mouse.wheel(0, scrollDelta);
    await page.waitForTimeout(200 + Math.random() * 300);
  }
}

async function humanHold(x: number, y: number, duration: number, page: Page): Promise<void> {
  const mouse = page.mouse;
  const holdSteps = Math.floor(duration / 80);
  const breathFreq = 0.15 + Math.random() * 0.1;
  const breathAmpX = 0.3 + Math.random() * 0.4;
  const breathAmpY = 0.2 + Math.random() * 0.3;

  await mouse.down();

  for (let i = 0; i < holdSteps; i++) {
    // Sine-wave breathing movement (natural hand tremor)
    const breathX = Math.sin(i * breathFreq) * breathAmpX;
    const breathY = Math.cos(i * breathFreq * 0.7) * breathAmpY;

    // Occasional micro-adjustment
    const adjX = Math.random() > 0.95 ? (Math.random() - 0.5) * 2 : 0;
    const adjY = Math.random() > 0.95 ? (Math.random() - 0.5) * 2 : 0;

    await mouse.move(x + breathX + adjX, y + breathY + adjY);
    await page.waitForTimeout(60 + Math.random() * 40);
  }

  // Release with slight upward drift
  await mouse.move(x + (Math.random() - 0.5) * 3, y - 1 - Math.random() * 2);
  await page.waitForTimeout(30 + Math.random() * 50);
  await mouse.up();
}

async function humanClick(locator: any, page: Page): Promise<void> {
  const box = await locator.first().boundingBox();
  if (box) {
    const clickX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const clickY = box.y + box.height * (0.3 + Math.random() * 0.4);
    await humanMove(clickX, clickY, page);
    await page.waitForTimeout(60 + Math.random() * 100);
    await page.mouse.down();
    await page.waitForTimeout(50 + Math.random() * 80);
    await page.mouse.up();
  } else {
    await locator.first().click({ force: true });
  }
}

interface BrowserSession {
  context: BrowserContext;
  page: Page;
  profileDir: string;
}

const sessions = new Map<string, BrowserSession>();
const sessionProxies = new Map<string, string>();
const MAX_BROWSER_SESSIONS = 3;
let currentSessionKey = 'default';
let consecutiveEvalFailures = 0;
let lastEvalCode = '';
let browserHeadless = process.env.BROWSER_HEADLESS !== 'false';
let browserProxy = process.env.BROWSER_PROXY || '';

export function setBrowserSession(key: string): void {
  currentSessionKey = key;
}

export function getBrowserSession(): string {
  return currentSessionKey;
}

function getSession(): BrowserSession | undefined {
  return sessions.get(currentSessionKey);
}

async function closeAllSessions(): Promise<void> {
  for (const [key, session] of sessions) {
    await session.context.close().catch(() => {});
  }
  sessions.clear();
}

function getProxyPool(): string[] {
  try {
    const config = loadConfig();
    return config.browser?.proxies || [];
  } catch {
    return [];
  }
}

function pickRandomProxy(): string {
  const pool = getProxyPool();
  if (pool.length === 0) return '';
  return pool[Math.floor(Math.random() * pool.length)];
}

interface GeoInfo {
  latitude: number;
  longitude: number;
  country: string;
  city: string;
  timezone: string;
}

const geoCache = new Map<string, GeoInfo>();

const FALLBACK_GEO: GeoInfo = {
  latitude: 40.7128,
  longitude: -74.006,
  country: 'US',
  city: 'New York',
  timezone: 'America/New_York',
};

async function lookupGeo(ip: string): Promise<GeoInfo> {
  if (geoCache.has(ip)) return geoCache.get(ip)!;
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,lat,lon,country,city,timezone`);
    const data = await res.json() as any;
    if (data.status === 'success') {
      const info: GeoInfo = {
        latitude: data.lat,
        longitude: data.lon,
        country: data.country,
        city: data.city,
        timezone: data.timezone,
      };
      geoCache.set(ip, info);
      return info;
    }
  } catch {}
  geoCache.set(ip, FALLBACK_GEO);
  return FALLBACK_GEO;
}

async function resolveGeoForProxy(proxyStr: string): Promise<GeoInfo> {
  if (!proxyStr) return FALLBACK_GEO;
  const host = proxyStr.split(':')[0];
  if (geoCache.has(host)) return geoCache.get(host)!;
  return await lookupGeo(host);
}

const BASE_PROFILE_DIR = join(homedir(), '.aurix-browser-profile');

function getProfileDir(): string {
  if (process.env.BROWSER_PERSISTENT_PROFILE === 'true') return BASE_PROFILE_DIR;
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${BASE_PROFILE_DIR}-${suffix}`;
}

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
];

function randomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
];

const WEBGL_RENDERERS = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
];

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function ensureBrowser(): Promise<Page> {
  const existing = getSession();
  if (existing && !existing.page.isClosed()) return existing.page;

  await ensureBinary();

  const profileDir = getProfileDir();
  const vp = randomViewport();
  const ua = randomPick(USER_AGENTS);
  const gpu = randomPick(WEBGL_RENDERERS);
  const screenW = vp.width + [0, 0, 256, 320][Math.floor(Math.random() * 4)];
  const screenH = Math.round(screenW * (vp.height / vp.width));
  const sessionNoise = Math.random() * 0.01;
  const hwConcurrency = randomPick([4, 6, 8, 12, 16]);
  const devMemory = randomPick([4, 8, 16]);
  const netDownlink = randomPick([1.5, 3.2, 5.8, 10, 25]);
  const netRtt = randomPick([50, 100, 150, 200, 250]);

  const activeProxy = browserProxy || pickRandomProxy();
  const geo = await resolveGeoForProxy(activeProxy);

  const launchOpts: Record<string, any> = {
    userDataDir: profileDir,
    headless: browserHeadless,
    humanize: true,
    humanPreset: 'careful',
    stealthArgs: true,
    colorScheme: 'light',
    viewport: vp,
    userAgent: ua,
    timezone: geo.timezone,
    contextOptions: {
      geolocation: { latitude: geo.latitude, longitude: geo.longitude },
      permissions: ['geolocation'],
    },
    args: [
      '--disable-webrtc',
      '--disable-rtc-sdp-logs',
      '--disable-background-networking',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-features=WebRtcHideLocalIpsWithMdns,TranslateUI',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      `--window-size=${vp.width},${vp.height}`,
      `--fingerprint=${Math.floor(Math.random() * 999999)}`,
      '--fingerprint-platform=windows',
      `--fingerprint-hardware-concurrency=${hwConcurrency}`,
      `--fingerprint-device-memory=${devMemory}`,
      `--fingerprint-screen-width=${screenW}`,
      `--fingerprint-screen-height=${screenH}`,
      `--fingerprint-timezone=${geo.timezone}`,
      '--fingerprint-locale=en-US',
      '--fingerprint-brand=Chrome',
      '--fingerprint-webrtc-ip=auto',
    ],
  };

  const parts = activeProxy.split(':');
  if (parts.length >= 2) {
    const host = parts[0];
    const port = parts[1];
    const server = `http://${host}:${port}`;
    launchOpts.proxy = { server };
    if (parts.length >= 4) {
      launchOpts.proxy.username = parts[2];
      launchOpts.proxy.password = parts[3];
    }
  }

  const context = await launchPersistentContext(launchOpts as any);

  await context.addInitScript({
    content: `(() => {
      const gpuVendor = ${JSON.stringify(gpu.vendor)};
      const gpuRenderer = ${JSON.stringify(gpu.renderer)};
      const sWidth = ${screenW};
      const sHeight = ${screenH};
      const hwConc = ${hwConcurrency};
      const devMem = ${devMemory};
      const noise = ${sessionNoise};
      const downlink = ${netDownlink};
      const rtt = ${netRtt};

      const fakePc = class { constructor() {} addStream() {} createOffer() { return Promise.resolve({}); } setLocalDescription() { return Promise.resolve(); } setRemoteDescription() { return Promise.resolve(); } addIceCandidate() { return Promise.resolve(); } close() {} };
      window.RTCPeerConnection = fakePc;
      window.webkitRTCPeerConnection = fakePc;
      window.mozRTCPeerConnection = fakePc;

      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => hwConc });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => devMem });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

      Object.defineProperty(screen, 'width', { get: () => sWidth });
      Object.defineProperty(screen, 'height', { get: () => sHeight });
      Object.defineProperty(screen, 'availWidth', { get: () => sWidth });
      Object.defineProperty(screen, 'availHeight', { get: () => sHeight - 40 });
      Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
      Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });

      if (navigator.connection) {
        Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
        Object.defineProperty(navigator.connection, 'downlink', { get: () => downlink });
        Object.defineProperty(navigator.connection, 'rtt', { get: () => rtt });
        Object.defineProperty(navigator.connection, 'saveData', { get: () => false });
      }

      const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (param) {
        if (param === 37445) return gpuVendor;
        if (param === 37446) return gpuRenderer;
        return getParameterOrig.call(this, param);
      };
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const getParameter2Orig = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function (param) {
          if (param === 37445) return gpuVendor;
          if (param === 37446) return gpuRenderer;
          return getParameter2Orig.call(this, param);
        };
      }

      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const style = ctx.fillStyle;
          ctx.fillStyle = 'rgba(0,0,0,' + noise + ')';
          ctx.fillRect(0, 0, 1, 1);
          ctx.fillStyle = style;
        }
        return origToDataURL.apply(this, [type, quality]);
      };

      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (sx, sy, sw, sh) {
        const data = origGetImageData.call(this, sx, sy, sw, sh);
        for (let i = 0; i < data.data.length; i += 4) {
          data.data[i] ^= 1;
        }
        return data;
      };

      if (AudioContext.prototype.createOscillator) {
        const origCreateOsc = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () {
          const osc = origCreateOsc.call(this);
          osc._freqOffset = (Math.random() - 0.5) * noise * 10;
          return osc;
        };
      }

      if (window.Permissions && window.Permissions.prototype.query) {
        const originalQuery = window.Permissions.prototype.query;
        window.Permissions.prototype.query = function (params) {
          if (params.name === 'notifications') return Promise.resolve({ state: 'default' });
          if (params.name === 'geolocation') return Promise.resolve({ state: 'granted' });
          return originalQuery.call(this, params);
        };
      }

      const originalToString = Function.prototype.toString;
      Function.prototype.toString = function () {
        if (this === Function.prototype.toString) return 'function toString() { [native code] }';
        if (this === WebGLRenderingContext.prototype.getParameter) return 'function getParameter() { [native code] }';
        return originalToString.call(this);
      };
    })();`,
  });

  const page = context.pages()[0] || await context.newPage();
  
  sessions.set(currentSessionKey, { context, page, profileDir });
  return page;
}

async function closeBrowser(): Promise<void> {
  const session = getSession();
  if (session) {
    await session.context.close().catch(() => {});
    sessions.delete(currentSessionKey);
  }
}

function describePage(page: Page): string {
  const session = getSession();
  const profilePath = session?.profileDir || BASE_PROFILE_DIR;
  return `[Browser: Chromium] Profile: ${profilePath}\nURL: ${page.url()}\nTitle: ${page.title()}`;
}

async function resolveLocator(p: Page, target: string) {
  let locator: any;
  if (target.startsWith('#') || target.startsWith('.') || target.startsWith('[') || target.includes('>')) {
    locator = p.locator(target);
  } else if (target.startsWith('text=')) {
    locator = p.locator(target);
  } else if (target.startsWith('role=')) {
    const role = target.slice(5).trim();
    locator = p.getByRole(role as any);
  } else if (target.startsWith('placeholder=')) {
    locator = p.getByPlaceholder(target.slice(12));
  } else if (target.startsWith('label=')) {
    locator = p.getByLabel(target.slice(6));
  } else {
    locator = p.getByText(target, { exact: false });
  }

  const mainCount = await locator.count();
  if (mainCount > 0) return locator;

  for (const frame of p.frames()) {
    if (frame === p.mainFrame()) continue;
    let frameLocator: any;
    if (target.startsWith('#') || target.startsWith('.') || target.startsWith('[') || target.includes('>') || target.startsWith('text=')) {
      frameLocator = frame.locator(target);
    } else if (target.startsWith('role=')) {
      frameLocator = frame.getByRole(target.slice(5).trim() as any);
    } else if (target.startsWith('placeholder=')) {
      frameLocator = frame.getByPlaceholder(target.slice(12));
    } else if (target.startsWith('label=')) {
      frameLocator = frame.getByLabel(target.slice(6));
    } else {
      frameLocator = frame.getByText(target, { exact: false });
    }
    if (await frameLocator.count() > 0) return frameLocator;
  }

  return locator;
}

async function autoSolveCaptcha(p: Page): Promise<string[]> {
  const results: string[] = [];
  const frames = p.frames();

  let recaptchaAnchor: any = null;
  let recaptchaBframe: any = null;
  let geetestSlider: any = null;
  let turnstileFrame: any = null;

  for (const frame of frames) {
    const url = frame.url();
    if (url.includes('/recaptcha/') && url.includes('/anchor')) recaptchaAnchor = frame;
    if (url.includes('/recaptcha/') && url.includes('/bframe')) recaptchaBframe = frame;
    if (url.includes('geetest.com') || url.includes('captcha.com')) {
      const hasSlider = await frame.locator('.geetest_slider_button, .geetest_slider').count();
      if (hasSlider > 0) geetestSlider = frame;
    }
    if (url.includes('challenges.cloudflare') || url.includes('turnstile')) turnstileFrame = frame;
  }

  if (turnstileFrame) {
    try {
      const checkbox = turnstileFrame.locator('input[type="checkbox"], .cf-turnstile, [role="checkbox"]').first();
      if (await checkbox.count() > 0) {
        await checkbox.click({ timeout: 5000 });
        await p.waitForTimeout(3000);
        // Don't claim "solved" — verify the widget actually reported success.
        const tsOk = await turnstileFrame.locator('input[type="hidden"][name="cf-turnstile-response"], [data-state="success"], .success').count().catch(() => 0);
        const tsError = await turnstileFrame.locator('.error, [data-state="error"], [data-state="failed"]').count().catch(() => 0);
        if (tsOk > 0) results.push('Turnstile: checkbox clicked, widget reports success');
        else if (tsError > 0) results.push('Turnstile: checkbox clicked but widget shows an error — may need a screenshot to inspect');
        else results.push('Turnstile: checkbox clicked, outcome unconfirmed — take a screenshot to verify the page advanced before submitting');
      }
    } catch (e: any) {
      results.push(`Turnstile: auto-click attempted (${e.message?.slice(0, 80)})`);
    }
  }

  if (recaptchaAnchor && !recaptchaBframe) {
    try {
      const checkbox = recaptchaAnchor.locator('#recaptcha-anchor, .recaptcha-checkbox-border, .rc-anchor-checkbox').first();
      if (await checkbox.count() > 0) {
        await checkbox.click({ timeout: 5000 });
        await p.waitForTimeout(2000);
        // The checkbox click may pass instantly OR pop an image challenge.
        // Report which actually happened instead of claiming success.
        const checked = await recaptchaAnchor.locator('.recaptcha-checkbox-checked, .rc-anchor-checkbox-checked').count().catch(() => 0);
        const challengeOpened = p.frames().some((f: any) => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
        if (checked > 0) results.push('reCAPTCHA: checkbox verified (checked) — no image challenge');
        else if (challengeOpened) results.push('reCAPTCHA: checkbox clicked, image challenge appeared — use captcha-grid to solve it');
        else results.push('reCAPTCHA: checkbox clicked, outcome unconfirmed — take a screenshot to verify before submitting');
      }
    } catch (e: any) {
      results.push(`reCAPTCHA checkbox: auto-click attempted (${e.message?.slice(0, 80)})`);
    }
  }

  if (geetestSlider) {
    try {
      const sliderInfo = await geetestSlider.evaluate(() => {
        const info: Record<string, any> = {};
        const cut = document.querySelector('.geetest_cut, .geetest_piece_bg, [class*="geetest_cut"], [class*="slider_cut"]');
        if (cut) {
          const cutRect = cut.getBoundingClientRect();
          const style = window.getComputedStyle(cut);
          info.cut = { left: cutRect.left, width: cutRect.width, styleLeft: parseFloat(style.left) || null, transform: style.transform || null };
        }
        const bg = document.querySelector('.geetest_canvas_bg, .geetest_bg, [class*="geetest_canvas"], canvas[class*="bg"]');
        if (bg) info.bg = { left: bg.getBoundingClientRect().left, width: bg.getBoundingClientRect().width };
        const piece = document.querySelector('.geetest_piece, [class*="slider_piece"]');
        if (piece) info.piece = { width: piece.getBoundingClientRect().width };
        const slider = document.querySelector('.geetest_slider_button, [class*="slider_button"]');
        if (slider) {
          const r = slider.getBoundingClientRect();
          info.slider = { left: r.left, width: r.width, centerX: r.left + r.width / 2, centerY: r.top + r.height / 2 };
        }
        return info;
      });

      let gapOffset: number | null = null;
      if (sliderInfo.cut && sliderInfo.bg) {
        if (sliderInfo.cut.styleLeft && sliderInfo.cut.styleLeft > 0) gapOffset = Math.round(sliderInfo.cut.styleLeft);
        else gapOffset = Math.round(sliderInfo.cut.left - sliderInfo.bg.left);
      }
      if (gapOffset === null && sliderInfo.cut?.transform && sliderInfo.cut.transform !== 'none') {
        const match = sliderInfo.cut.transform.match(/matrix\(.*?,\s*([\d.]+)/);
        if (match) gapOffset = Math.round(parseFloat(match[1]));
      }

      if (gapOffset !== null && sliderInfo.slider) {
        const pieceHalf = Math.round((sliderInfo.piece?.width || 44) / 2);
        const dragDistance = gapOffset - pieceHalf;
        const startX = sliderInfo.slider.centerX;
        const startY = sliderInfo.slider.centerY;
        const endX = startX + dragDistance;

        await p.mouse.move(startX, startY);
        await p.waitForTimeout(150);
        await p.mouse.down();
        await p.waitForTimeout(200);

        const steps = 18 + Math.floor(Math.random() * 8);
        for (let i = 1; i <= steps; i++) {
          const progress = i / steps;
          const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          const x = startX + dragDistance * eased + (Math.random() - 0.5) * 2;
          const y = startY + (Math.random() - 0.5) * 2;
          await p.mouse.move(x, y);
          await p.waitForTimeout(10 + Math.random() * 20);
        }
        await p.mouse.move(endX, startY);
        await p.waitForTimeout(150);
        await p.mouse.up();
        await p.waitForTimeout(2000);

        results.push(`GeeTest: slider dragged ${dragDistance}px — outcome unconfirmed, take a screenshot to verify the gap was matched`);
      } else {
        results.push('GeeTest slider detected but gap position could not be auto-detected');
      }
    } catch (e: any) {
      results.push(`GeeTest slider: auto-solve attempted (${e.message?.slice(0, 80)})`);
    }
  }

  if (recaptchaBframe) {
    const gridResult = await analyzeImageChallenge(p, recaptchaBframe, 'recaptcha');
    results.push('reCAPTCHA image challenge detected — grid analysis:');
    results.push(gridResult);
  }

  const funcaptchaFrame = frames.find(f => f.url().includes('funcaptcha') || f.url().includes('arkoselabs'));
  if (funcaptchaFrame) {
    results.push('FunCaptcha detected — screenshotting puzzle...');
    try {
      const fcScreenshotPath = join(homedir(), '.aurix-funcaptcha-puzzle.png');
      await funcaptchaFrame.locator('body').screenshot({ path: fcScreenshotPath }).catch(() => p.screenshot({ path: fcScreenshotPath }));
      results.push(`Puzzle screenshot: ${fcScreenshotPath}`);
      results.push('Analyze the puzzle image and determine the correct answer, then use click/evaluate to solve it.');
    } catch {
      results.push('REQUIRES_VISION: FunCaptcha detected — needs image analysis to solve');
    }
  }

  return results;
}

async function findGridTiles(frame: any, provider: string) {
  switch (provider) {
    case 'recaptcha': {
      const tiles33 = frame.locator('.rc-imageselect-table-33 td, .rc-image-tile-33 td');
      if (await tiles33.count() > 0) return tiles33.all();
      const tiles44 = frame.locator('.rc-imageselect-table-44 td, .rc-image-tile-44 td');
      if (await tiles44.count() > 0) return tiles44.all();
      const generic = frame.locator('table td');
      if (await generic.count() > 0) return generic.all();
      return [];
    }
    case 'hcaptcha': {
      const tiles = frame.locator('.task-image, .image, .task .answer');
      if (await tiles.count() > 0) return tiles.all();
      return [];
    }
    case 'mtcaptcha':
    case 'geetest': {
      const items = frame.locator('.geetest_item_wrap, .geetest_ques_tips img, .mtcaptcha-item');
      if (await items.count() > 0) return items.all();
      return [];
    }
    default: {
      const tiles = frame.locator('.task-image, .rc-imageselect-table-33 td, .rc-imageselect-table-44 td, table td');
      if (await tiles.count() > 0) return tiles.all();
      return [];
    }
  }
}

async function analyzeImageChallenge(page: any, frame: any, provider: string): Promise<string> {
  const results: string[] = [];

  let instruction = '';
  try {
    const instrEl = frame.locator('.rc-imageselect-instructions, .prompt-text, .prompt-text-h, .geetest_tip_content, .mtcaptcha-label');
    if (await instrEl.count() > 0) {
      instruction = (await instrEl.first().textContent()) || '';
      instruction = instruction.trim();
    }
    if (!instruction) {
      const strongText = frame.locator('strong').first();
      if (await strongText.count() > 0) {
        instruction = (await strongText.textContent()) || '';
      }
    }
  } catch {}

  if (instruction) {
    results.push(`Instruction: "${instruction}"`);
  } else {
    results.push('Instruction: (could not extract — check screenshot)');
  }

  const tiles = await findGridTiles(frame, provider);
  const gridSize = tiles.length <= 9 ? '3x3' : tiles.length <= 16 ? '4x4' : `${tiles.length}-tile`;
  results.push(`Grid: ${gridSize} (${tiles.length} tiles found)`);
  _lastGridAnalyzeTime = Date.now();

  // Clear stale tile screenshots from a previous challenge so the model never
  // reads an old .aurix-tile-N.png that no longer matches the current grid.
  try {
    const home = homedir();
    for (const f of readdirSync(home)) {
      if (/^\.aurix-tile-(\d+|after-\d+)\.png$/.test(f)) {
        try { unlinkSync(join(home, f)); } catch {}
      }
    }
  } catch {}

  const screenshotPath = join(homedir(), '.aurix-captcha-grid.png');
  try {
    const gridEl = frame.locator('.rc-imageselect-table-33, .rc-imageselect-table-44, .task, .challenge-view, .geetest_panel, table').first();
    if (await gridEl.count() > 0) {
      await gridEl.screenshot({ path: screenshotPath });
    } else {
      await frame.locator('body').screenshot({ path: screenshotPath });
    }
  } catch {
    try {
      await page.screenshot({ path: screenshotPath });
    } catch {}
  }
  results.push(`Grid screenshot: ${screenshotPath}`);

  for (let i = 0; i < tiles.length; i++) {
    const tilePath = join(homedir(), `.aurix-tile-${i}.png`);
    try {
      await tiles[i].screenshot({ path: tilePath });
      results.push(`  Tile ${i}: ${tilePath}`);
    } catch {
      results.push(`  Tile ${i}: (screenshot failed)`);
    }
  }

  const isRecaptcha = provider === 'recaptcha';
  const selectedClass = isRecaptcha ? '.rc-imageselect-dynamic-selected' : '.task-image.selected, .task .selected';
  const selectedCount = await frame.locator(selectedClass).count();
  if (selectedCount > 0) {
    results.push(`Already selected: ${selectedCount} tile(s)`);
  }

  results.push('');
  results.push('=== IMAGE SELECTION STEPS ===');
  results.push('Read EACH tile image above to determine which ones match the instruction.');
  results.push('Then execute these actions IN ORDER:');
  results.push('');
  results.push('Step 1: For each matching tile, call: browser action="click-tile" value="<index>"');
  results.push('  Example: if tiles 0, 3, and 5 match → click-tile 0, then click-tile 3, then click-tile 5');
  if (provider === 'recaptcha') {
    results.push('  IMPORTANT: After clicking a tile, a NEW tile replaces it. Read the new tile screenshot to check if it also matches.');
  }
  results.push('Step 2: After clicking ALL matching tiles, call: browser action="captcha-verify"');
  results.push('Step 3: If the grid refreshes with new tiles, call captcha-grid again and repeat from Step 1');
  results.push('');
  results.push('Do NOT skip any step. Start by reading the tile images now.');

  return results.join('\n');
}

export const browserTool: Tool = {
  name: 'browser',
  description: `Persistent Chromium browser. Profile: ~/.aurix-browser-profile.

# HARD RULES — VIOLATE THESE AND YOU FAIL
1. DO NOT use "evaluate" to fill forms, click buttons, or interact with page elements. Use fill, click, type, signup-assist, signin-assist instead. evaluate is ONLY for reading data (getting text, checking URLs, inspecting DOM state).
2. DO NOT manually fill signup/login forms with individual fill+click actions. ALWAYS use signup-assist or signin-assist — one call does everything.
3. DO NOT take 4+ screenshots in a row without fill/click/type in between. Screenshot → act → screenshot to verify is fine. Screenshot → screenshot → screenshot is a loop.
4. If an action fails TWICE, STOP and try a COMPLETELY DIFFERENT approach. Never repeat the same failing action.
5. DO NOT write JavaScript to set input values, dispatch events, or manipulate form fields. Playwright fill/click handles React, Angular, Vue forms natively.

# WORKFLOW: Sign Up / Register
Step 1: navigate to the signup page
Step 2: signup-assist with user data — ONE call fills ALL fields, clicks checkboxes, submits:
  action="signup-assist" value='{"email":"user@mail.com","password":"Pass123!","firstName":"John","lastName":"Doe"}'
Step 3: If multi-step form, run signup-assist again on the next page
Step 4: If captcha appears → use solve-captcha → then continue

# WORKFLOW: Log In
Step 1: navigate to the login page
Step 2: signin-assist — ONE call:
  action="signin-assist" value='{"email":"user@mail.com","password":"Pass123!"}'

# WORKFLOW: Individual Field Fill (only if signup-assist didn't cover it)
Step 1: fill target="selector" value="text" — Playwright handles React/Angular/Vue inputs natively
Step 2: If fill fails → try type (simulates keystrokes, works on stubborn React inputs)
Step 3: If type fails → click the input first, then type again
Step 4: If ALL 3 fail → take a snapshot to find a better selector, then retry

# Captcha Auto-Solve (all types)
- solve-captcha: ONE call auto-solves image grids, sliders, FunCaptcha. Use this FIRST.
- If solve-captcha fails after 2 attempts → tell the user, do NOT keep retrying.

# Action Reference
Forms: signup-assist, signin-assist, fill, type, click, select, press-key, upload
Navigation: navigate, back, forward, scroll, new-tab, switch-tab, close-tab, open-tabs
Read: screenshot, snapshot, text, html, url, title, cookies
Advanced: evaluate (READ ONLY), drag-to, hold-click, wait
Captcha: detect-captcha, solve-captcha, captcha-grid, click-tile, captcha-verify, slider-analyze
Config: set-proxy, set-ui, status, close

Target: CSS (#id, .class, [attr]), text="...", role=button, placeholder="...", label="...", or plain text.
Sessions: session="a"/"b"/"c" for parallel browsers. proxy="host:port:user:pass" per session.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Browser action to perform',
      },
      target: {
        type: 'string',
        description: 'Target element: CSS selector, text="...", role=..., placeholder="...", label="...", or plain text',
      },
      value: {
        type: 'string',
        description: 'Value for fill/type actions, URL for navigate, key for press-key, expression for evaluate, or tab index for switch-tab',
      },
      options: {
        type: 'string',
        description: 'Additional options as JSON string, e.g. \'{"timeout": 5000}\' or \'{"selector": ".class"}\'',
      },
      session: {
        type: 'string',
        description: 'Browser session key (default: "default"). Use distinct keys (e.g. "a", "b", "c") to drive up to 3 independent browsers in parallel — each has its own profile, cookies, and proxy.',
      },
      proxy: {
        type: 'string',
        description: 'Optional proxy for THIS session, e.g. "host:port" or "host:port:user:pass". If omitted, a proxy is auto-picked from config. Each session may use a different proxy.',
      },
    },
    required: ['action'],
  },

  async execute(args) {
    const action = args.action as string;
    const target = args.target as string;
    const value = args.value as string;
    const options = args.options ? JSON.parse(args.options as string) : {};
    const timeout = options.timeout || 15000;

    // Multi-session: route this call to the requested browser (default "default").
    const sessionKey = (args.session as string)?.trim() || 'default';
    if (!sessions.has(sessionKey) && sessions.size >= MAX_BROWSER_SESSIONS && !['close', 'close-all', 'status'].includes(action)) {
      return err(`Max ${MAX_BROWSER_SESSIONS} concurrent browser sessions reached`, `Active: ${[...sessions.keys()].join(', ')}. Reuse one or close it with action="close" session="<key>".`);
    }
    setBrowserSession(sessionKey);
    // Per-session proxy: explicit arg wins; otherwise pick one for a fresh session.
    if (args.proxy) {
      sessionProxies.set(sessionKey, String(args.proxy));
    }
    browserProxy = sessionProxies.get(sessionKey) || (args.proxy ? String(args.proxy) : '');

    try {
      switch (action) {
        case 'set-proxy': {
          if (!value && !target) return err('set-proxy requires a proxy address', 'Examples: "host:port", "user:pass@host:port", or "off" to disable');
          const proxy = value || target || '';
          if (proxy === 'off' || proxy === 'none' || proxy === '') {
            browserProxy = '';
            await closeBrowser();
            return ok('Proxy disabled. Browser will restart on next action.');
          }
          browserProxy = proxy;
          await closeBrowser();
          return ok(`Proxy set to ${proxy}. Browser will restart with proxy on next action.`, {
            proxy: proxy,
            note: 'If proxy requires auth, use format: user:pass@host:port',
          });
        }

        case 'set-ui': {
          const mode = (value || target || '').toLowerCase();
          if (mode === 'on' || mode === 'show' || mode === 'headed' || mode === 'visible' || mode === 'true') {
            browserHeadless = false;
            await closeBrowser();
            return ok('Browser UI enabled (headed mode). Browser will restart on next action.', {
              mode: 'headed — browser window will be visible',
            });
          } else if (mode === 'off' || mode === 'hide' || mode === 'headless' || mode === 'false') {
            browserHeadless = true;
            await closeBrowser();
            return ok('Browser UI disabled (headless mode). Browser will restart on next action.', {
              mode: 'headless — browser runs in background',
            });
          }
          return `Current mode: ${browserHeadless ? 'headless (hidden)' : 'headed (visible)'}\n\nUse: set-ui value="on" (show window) or set-ui value="off" (hide window)`;
        }

        case 'open-tabs': {
          const p = await ensureBrowser();
          const session = getSession()!;
          const count = parseInt(value) || 3;
          const urls = target ? target.split(',').map(s => s.trim()) : [];
          const tabs: string[] = [];

          for (let i = 0; i < count; i++) {
            const newPage = await session.context.newPage();
            if (urls[i]) {
              const url = urls[i].startsWith('http') ? urls[i] : `https://${urls[i]}`;
              await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch(() => {});
              tabs.push(`Tab ${i + 1}: ${newPage.url()} — ${await newPage.title().catch(() => '')}`);
            } else {
              tabs.push(`Tab ${i + 1}: blank`);
            }
          }

          return ok(`Opened ${count} tabs`, {
            total: `${session.context.pages().length} tabs open`,
            tabs: tabs.join('\n'),
            hint: 'Use switch-tab to navigate between tabs, or run signup-assist/signin-assist on the current tab',
          });
        }

        case 'status': {
          const session = getSession();
          if (!session || session.page.isClosed()) {
            return `Browser: not running. Use action "navigate" to start it.\nProfile: ${BASE_PROFILE_DIR}\nEngine: Chromium\nMode: ${browserHeadless ? 'headless' : 'headed'}\nProxy: ${browserProxy || 'none'}`;
          }
          const title = await session.page.title();
          return `Browser: running\nEngine: Chromium\nProfile: ${session.profileDir}\nMode: ${browserHeadless ? 'headless' : 'headed'}\nProxy: ${browserProxy || 'none'}\nURL: ${session.page.url()}\nTitle: ${title}\nOpen tabs: ${session.context.pages().length}`;
        }

        case 'close': {
          const session = getSession();
          const profilePath = session?.profileDir || BASE_PROFILE_DIR;
          await closeBrowser();
          return 'Browser closed. Profile preserved at ' + profilePath;
        }

        case 'navigate': {
          const p = await ensureBrowser();
          const url = value || target;
          if (!url) return 'Error: navigate requires a URL (use value or target parameter)';
          const fullUrl = url.startsWith('http') ? url : `https://${url}`;
          await p.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout });
          const title = await p.title();
          return `Navigated to: ${p.url()}\nTitle: ${title}`;
        }

        case 'click': {
          const p = await ensureBrowser();
          if (!target) return err('click requires a target element', 'Use a CSS selector, text="...", role=, or placeholder=');
          try {
            const locator = await resolveLocator(p, target);
            await locator.first().click({ timeout });
            await p.waitForTimeout(500);
            const ss = await autoScreenshot(p, 'click');
            return ok(`Clicked: ${target}`, {
              url: p.url(),
              title: await p.title(),
              screenshot: ss,
            });
          } catch (e: any) {
            const msg = e.message || String(e);
            if (msg.includes('Timeout')) return err(`Element "${target}" not found within timeout`, 'Use "snapshot" to see available elements, or "wait" to wait for page load');
            if (msg.includes('not visible') || msg.includes('intercepts pointer')) return err(`Element "${target}" is hidden or covered by another element`, 'Try a different selector, use "evaluate" with JS click, or scroll to the element first');
            if (msg.includes('strict mode') || msg.includes('more than one')) return err(`Multiple elements matched "${target}"`, 'Use a more specific selector or add .first()/.nth(0)');
            return err(`Click failed on "${target}": ${msg.slice(0, 150)}`, 'Use "snapshot" to check the current page state');
          }
        }

        case 'fill': {
          const p = await ensureBrowser();
          if (!target) return err('fill requires a target element', 'Use a CSS selector, placeholder="...", or label="..."');
          if (value === undefined) return err('fill requires a value', 'Provide the text to fill via the value parameter');
          try {
            const locator = await resolveLocator(p, target);
            await locator.first().fill(value, { timeout });
            const ss = await autoScreenshot(p, 'fill');
            return ok(`Filled "${target}"`, {
              value: value.length > 50 ? value.slice(0, 50) + '...' : value,
              screenshot: ss,
            });
          } catch (e: any) {
            const msg = e.message || String(e);
            if (msg.includes('Timeout')) return err(`Input "${target}" not found within timeout`, 'Use "snapshot" to see available form fields');
            try {
              const locator = await resolveLocator(p, target);
              await locator.first().click({ timeout: 3000 });
              await locator.first().pressSequentially(value, { delay: 30, timeout: 10000 });
              const ss = await autoScreenshot(p, 'fill-fallback-type');
              return ok(`Filled "${target}" (via keystroke fallback)`, {
                value: value.length > 50 ? value.slice(0, 50) + '...' : value,
                screenshot: ss,
              });
            } catch (e2: any) {
              return err(`Fill failed on "${target}": ${msg.slice(0, 150)}`, 'Use "type" action directly, or "snapshot" to find a better selector');
            }
          }
        }

        case 'type': {
          const p = await ensureBrowser();
          if (!target) return err('type requires a target element', 'Use a CSS selector, placeholder="...", or label="..."');
          if (value === undefined) return err('type requires a value', 'Provide the text to type via the value parameter');
          try {
            const locator = await resolveLocator(p, target);
            await locator.first().pressSequentially(value, { delay: 50 });
            const ss = await autoScreenshot(p, 'type');
            return ok(`Typed into "${target}"`, {
              value: value.length > 50 ? value.slice(0, 50) + '...' : value,
              screenshot: ss,
            });
          } catch (e: any) {
            const msg = e.message || String(e);
            if (msg.includes('Timeout')) return err(`Element "${target}" not found within timeout`, 'Use "snapshot" to see available elements');
            return err(`Type failed on "${target}": ${msg.slice(0, 150)}`, 'Use "snapshot" to check the current page state');
          }
        }

        case 'press-key': {
          const p = await ensureBrowser();
          const key = value || target;
          if (!key) return err('press-key requires a key', 'Examples: "Enter", "Tab", "Escape", "Control+a"');
          try {
            await p.keyboard.press(key);
            await p.waitForTimeout(300);
            const ss = await autoScreenshot(p, 'press-key');
            return ok(`Pressed key: ${key}`, {
              url: p.url(),
              screenshot: ss,
            });
          } catch (e: any) {
            return err(`Key press failed: ${e.message.slice(0, 150)}`, 'Check valid key names at Playwright docs (e.g. "Enter", "Tab", "Control+a")');
          }
        }

        case 'select': {
          const p = await ensureBrowser();
          if (!target) return err('select requires a target <select> element', 'Use a CSS selector for the <select> element');
          if (value === undefined) return err('select requires a value (option value)', 'Provide the option value to select');
          try {
            const locator = await resolveLocator(p, target);
            await locator.first().selectOption(value, { timeout });
            const ss = await autoScreenshot(p, 'select');
            return ok(`Selected "${value}" in "${target}"`, { screenshot: ss });
          } catch (e: any) {
            const msg = e.message || String(e);
            if (msg.includes('Timeout')) return err(`Select element "${target}" not found`, 'Use "snapshot" to find the correct selector');
            if (msg.includes('not a <select>')) return err(`"${target}" is not a <select> element`, 'Find the correct <select> element with "snapshot"');
            return err(`Select failed: ${msg.slice(0, 150)}`, 'Use "snapshot" to check available options');
          }
        }

        case 'screenshot': {
          const p = await ensureBrowser();
          const screenshotPath = options.path || join(homedir(), '.aurix-screenshot.png');
          if (target) {
            const locator = await resolveLocator(p, target);
            await locator.first().screenshot({ path: screenshotPath });
          } else {
            await p.screenshot({ path: screenshotPath, fullPage: !!options.fullPage });
          }
          return `Screenshot saved to: ${screenshotPath}`;
        }

        case 'snapshot': {
          const p = await ensureBrowser();
          const snapshot = await p.locator('body').evaluate((el) => {
            function walk(node: Element, depth: number): string {
              if (depth > 8) return '';
              const indent = '  '.repeat(depth);
              const tag = node.tagName?.toLowerCase() || '';
              const role = node.getAttribute('role') || '';
              const ariaLabel = node.getAttribute('aria-label') || '';
              const text = node.childNodes.length === 1 && node.childNodes[0].nodeType === 3
                ? (node.childNodes[0] as Text).textContent?.trim().slice(0, 80) || ''
                : '';
              const href = node.getAttribute('href') || '';
              const type = node.getAttribute('type') || '';
              const name = node.getAttribute('name') || '';
              const id = node.getAttribute('id') || '';
              let line = `${indent}<${tag}`;
              if (role) line += ` role="${role}"`;
              if (ariaLabel) line += ` aria-label="${ariaLabel}"`;
              if (href) line += ` href="${href}"`;
              if (type) line += ` type="${type}"`;
              if (name) line += ` name="${name}"`;
              if (id) line += ` id="${id}"`;
              line += '>';
              if (text) line += ` ${text}`;
              line += '\n';
              for (const child of Array.from(node.children)) {
                line += walk(child, depth + 1);
              }
              return line;
            }
            return walk(el, 0);
          });
          return snapshot || '(empty page)';
        }

        case 'text': {
          const p = await ensureBrowser();
          if (target) {
            const locator = await resolveLocator(p, target);
            const text = await locator.first().textContent({ timeout });
            return text || '(empty)';
          }
          const bodyText = await p.locator('body').innerText({ timeout: 5000 });
          return bodyText.length > 10000
            ? bodyText.slice(0, 10000) + `\n\n... [${bodyText.length - 10000} more chars]`
            : bodyText;
        }

        case 'html': {
          const p = await ensureBrowser();
          if (target) {
            const locator = await resolveLocator(p, target);
            const html = await locator.first().innerHTML({ timeout });
            return html;
          }
          const html = await p.content();
          return html.length > 15000
            ? html.slice(0, 15000) + `\n\n... [${html.length - 15000} more chars]`
            : html;
        }

        case 'url': {
          const p = await ensureBrowser();
          return p.url();
        }

        case 'title': {
          const p = await ensureBrowser();
          return await p.title();
        }

        case 'scroll': {
          const p = await ensureBrowser();
          const direction = value || 'down';
          const amount = options.amount || 500;
          if (target) {
            const locator = await resolveLocator(p, target);
            await locator.first().scrollIntoViewIfNeeded({ timeout });
            return `Scrolled to element: ${target}`;
          }
          const deltaY = direction === 'up' ? -amount : amount;
          await p.mouse.wheel(0, deltaY);
          await p.waitForTimeout(300);
          return `Scrolled ${direction} by ${amount}px`;
        }

        case 'back': {
          const p = await ensureBrowser();
          await p.goBack({ waitUntil: 'domcontentloaded', timeout });
          return `Navigated back\nURL: ${p.url()}\nTitle: ${await p.title()}`;
        }

        case 'forward': {
          const p = await ensureBrowser();
          await p.goForward({ waitUntil: 'domcontentloaded', timeout });
          return `Navigated forward\nURL: ${p.url()}\nTitle: ${await p.title()}`;
        }

        case 'wait': {
          const p = await ensureBrowser();
          if (target) {
            const locator = await resolveLocator(p, target);
            await locator.first().waitFor({ state: options.state || 'visible', timeout });
            return `Element appeared: ${target}`;
          }
          const ms = parseInt(value) || 2000;
          await p.waitForTimeout(ms);
          return `Waited ${ms}ms`;
        }

        case 'evaluate': {
          const p = await ensureBrowser();
          const code = value || target;
          if (!code) return 'Error: evaluate requires JavaScript code (use value parameter)';

          if (consecutiveEvalFailures >= 2 && code === lastEvalCode) {
            return `STOP. You've tried this exact evaluate code ${consecutiveEvalFailures} times and it failed every time.\n\n` +
              `DO NOT use evaluate again. Use these actions instead:\n` +
              `  1. snapshot — see all elements on the page (including inside iframes)\n` +
              `  2. fill target="input[name='email'], #email, input[type='email']" value="..." — fill a field\n` +
              `  3. click target="button[type='submit'], #submit, text=Next" — click a button\n` +
              `  4. type target="<selector>" value="..." — type into a field\n\n` +
              `These actions automatically search the main page AND all iframes. Start with "snapshot" to find the right selectors.`;
          }

          if (code !== lastEvalCode) {
            consecutiveEvalFailures = 0;
            lastEvalCode = '';
          }

          try {
            const result = await p.evaluate(code);
            consecutiveEvalFailures = 0;
            lastEvalCode = '';
            return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          } catch (evalErr: any) {
            const errMsg = evalErr.message || String(evalErr);
            if (errMsg.includes('null') || errMsg.includes('Cannot read propert') || errMsg.includes('Cannot set propert')) {
              lastEvalCode = code;
              consecutiveEvalFailures++;

              for (const frame of p.frames()) {
                if (frame === p.mainFrame()) continue;
                try {
                  const r = await frame.evaluate(code);
                  consecutiveEvalFailures = 0;
                  lastEvalCode = '';
                  return typeof r === 'string' ? r : JSON.stringify(r, null, 2);
                } catch {}
              }

              if (consecutiveEvalFailures >= 2) {
                return `STOP — evaluate has failed ${consecutiveEvalFailures} times with the same code. The element does not exist on this page or any iframe.\n\n` +
                  `You MUST switch to using click, fill, and type actions NOW. These actions auto-search all frames.\n` +
                  `First, run: action="snapshot" (no target needed) — this shows all elements.\n` +
                  `Then use the selectors from the snapshot with fill/click/type.`;
              }

              return `Error: Element not found on main page or iframes (attempt ${consecutiveEvalFailures}).\n\n` +
                `Use these actions instead — they auto-search all frames including iframes:\n` +
                `  click target="<selector>"\n` +
                `  fill target="<selector>" value="<text>"\n` +
                `  type target="<selector>" value="<text>"\n\n` +
                `Use "snapshot" first to find the correct selectors.`;
            }
            return `Browser error: ${errMsg.slice(0, 300)}`;
          }
        }

        case 'new-tab': {
          const p = await ensureBrowser();
          const session = getSession()!;
          const newPage = await session.context.newPage();
          if (value) {
            const url = value.startsWith('http') ? value : `https://${value}`;
            await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout });
          }
          session.page = newPage;
          sessions.set(currentSessionKey, session);
          return `New tab opened (${session.context.pages().length} tabs total)\nURL: ${newPage.url()}`;
        }

        case 'switch-tab': {
          const p = await ensureBrowser();
          const session = getSession()!;
          const pages = session.context.pages();
          const idx = parseInt(value) || 0;
          if (idx < 0 || idx >= pages.length) return `Error: tab index ${idx} out of range (0-${pages.length - 1})`;
          session.page = pages[idx];
          sessions.set(currentSessionKey, session);
          await session.page.bringToFront();
          return `Switched to tab ${idx}\nURL: ${session.page.url()}\nTitle: ${await session.page.title()}`;
        }

        case 'close-tab': {
          const p = await ensureBrowser();
          const session = getSession()!;
          const pages = session.context.pages();
          if (pages.length <= 1) return 'Cannot close the only tab. Use "close" to shut down the browser.';
          const idx = value ? parseInt(value) : pages.indexOf(p);
          const toClose = pages[idx];
          if (!toClose) return `Error: tab index ${idx} not found`;
          await toClose.close();
          session.page = session.context.pages()[0];
          sessions.set(currentSessionKey, session);
          return `Closed tab ${idx}. ${session.context.pages().length} tabs remaining.\nCurrent URL: ${session.page.url()}`;
        }

        case 'cookies': {
          const p = await ensureBrowser();
          const session = getSession()!;
          const cookies = await session.context.cookies(value ? [value] : undefined);
          if (cookies.length === 0) return 'No cookies found';
          return cookies.map(c => `${c.domain} | ${c.name}=${c.value.slice(0, 40)}${c.value.length > 40 ? '...' : ''}`).join('\n');
        }

        case 'upload': {
          const p = await ensureBrowser();
          if (!target) return 'Error: upload requires target (file input element)';
          if (!value) return 'Error: upload requires value (file path)';
          const locator = await resolveLocator(p, target);
          await locator.first().setInputFiles(value, { timeout });
          return `Uploaded file: ${value}`;
        }

        case 'detect-captcha': {
          const p = await ensureBrowser();
          const frames = p.frames();
          const captchaInfo: string[] = [];

          for (const frame of frames) {
            const url = frame.url();
            if (url.includes('recaptcha') || url.includes('google.com/recaptcha')) {
              captchaInfo.push(`reCAPTCHA iframe: ${url.slice(0, 100)}`);
            }
            if (url.includes('hcaptcha') || url.includes('newassets.hcaptcha')) {
              captchaInfo.push(`hCaptcha iframe: ${url.slice(0, 100)}`);
            }
            if (url.includes('funcaptcha') || url.includes('arkoselabs')) {
              captchaInfo.push(`FunCaptcha iframe: ${url.slice(0, 100)}`);
            }
            if (url.includes('geetest') || url.includes('captcha.com')) {
              captchaInfo.push(`GeeTest iframe: ${url.slice(0, 100)}`);
            }
          }

          const pageContent = await p.content();
          if (pageContent.includes('g-recaptcha') || pageContent.includes('recaptcha')) captchaInfo.push('reCAPTCHA element detected in DOM');
          if (pageContent.includes('h-captcha') || pageContent.includes('hcaptcha')) captchaInfo.push('hCaptcha element detected in DOM');
          if (pageContent.includes('cf-turnstile') || pageContent.includes('challenges.cloudflare')) captchaInfo.push('Cloudflare Turnstile detected');
          if (pageContent.includes('captcha-image') || pageContent.includes('captcha_img')) captchaInfo.push('Image verification widget detected — use "solve-captcha" to analyze and complete');

          if (captchaInfo.length === 0) return 'No verification widgets detected on this page.';
          return `Verification widgets detected:\n${captchaInfo.map(c => `  - ${c}`).join('\n')}\n\nUse action "solve-captcha" to complete the verification.`;
        }

        case 'solve-captcha': {
          const p = await ensureBrowser();
          const results: string[] = [];

          const frames = p.frames();
          let captchaType = 'unknown';

          let recaptchaAnchor: any = null;
          let recaptchaBframe: any = null;
          let hcaptchaCheckbox: any = null;
          let hcaptchaChallenge: any = null;
          let funcaptchaFrame: any = null;
          let mtcaptchaFrame: any = null;
          let geetestFrame: any = null;

          for (const frame of frames) {
            const url = frame.url();
            if (url.includes('/recaptcha/') && url.includes('/anchor')) recaptchaAnchor = frame;
            if (url.includes('/recaptcha/') && url.includes('/bframe')) recaptchaBframe = frame;
            if (url.includes('newassets.hcaptcha.com') && !url.includes('challenge')) hcaptchaCheckbox = frame;
            if (url.includes('hcaptcha') && url.includes('challenge')) hcaptchaChallenge = frame;
            if (url.includes('funcaptcha') || url.includes('arkoselabs')) funcaptchaFrame = frame;
            if (url.includes('service.mtcaptcha')) mtcaptchaFrame = frame;
            if ((url.includes('geetest.com') || url.includes('captcha.com')) && !url.includes('recaptcha') && !url.includes('hcaptcha')) geetestFrame = frame;
          }

          if (recaptchaAnchor) captchaType = 'recaptcha';
          else if (hcaptchaCheckbox) captchaType = 'hcaptcha';
          else if (funcaptchaFrame) captchaType = 'funcaptcha';
          else if (mtcaptchaFrame) captchaType = 'mtcaptcha';
          else if (geetestFrame) captchaType = 'geetest';

          const pageContent = await p.content();
          if (captchaType === 'unknown' && (pageContent.includes('cf-turnstile') || pageContent.includes('challenges.cloudflare'))) {
            captchaType = 'turnstile';
          }
          if (captchaType === 'unknown' && (pageContent.includes('mtcaptcha') || pageContent.includes('MTCaptcha'))) {
            captchaType = 'mtcaptcha';
          }
          if (captchaType === 'unknown' && recaptchaBframe) captchaType = 'recaptcha';

          if (captchaType === 'recaptcha') {
            results.push('Attempting reCAPTCHA...');
            try {
              let checkboxFrame = recaptchaAnchor;
              if (!checkboxFrame) {
                for (const frame of frames) {
                  const url = frame.url();
                  if (url.includes('recaptcha') && (url.includes('anchor') || url.includes('api2/'))) {
                    checkboxFrame = frame;
                    break;
                  }
                }
              }

              if (checkboxFrame) {
                const checkbox = checkboxFrame.locator('#recaptcha-anchor, .recaptcha-checkbox, .rc-anchor-checkbox');
                if (await checkbox.count() > 0) {
                  await p.waitForTimeout(1000 + Math.random() * 1500);
                  await humanClick(checkbox, p);
                  await p.waitForTimeout(3000);

                  const updatedFrames = p.frames();
                  const challengeFrame = updatedFrames.find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
                  if (challengeFrame) {
                    results.push('Image challenge appeared. Auto-solving...');
                    const maxRetries = 3;
                    let solved = false;
                    for (let attempt = 0; attempt < maxRetries; attempt++) {
                      if (attempt > 0) results.push(`\nRetry attempt ${attempt}/${maxRetries - 1}...`);
                      const solveResult = await solveCaptchaGrid(p, challengeFrame, 'recaptcha');
                      results.push(solveResult);

                      if (solveResult.includes('Captcha solved!')) {
                        solved = true;
                        break;
                      }

                      if (solveResult.includes('Falling back to manual mode')) {
                        break;
                      }

                      await p.waitForTimeout(2000);
                      const refreshedFrames = p.frames();
                      const newChallenge = refreshedFrames.find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
                      if (!newChallenge) {
                        results.push('Challenge frame disappeared, captcha may be solved');
                        solved = true;
                        break;
                      }
                    }
                    if (!solved && !results.some(r => r.includes('Falling back'))) {
                      results.push(`\nAuto-solve exhausted after ${maxRetries} attempts. Use "captcha-grid" and "click-tile" for manual solving.`);
                    }
                  } else {
                    const checkmark = checkboxFrame.locator('.recaptcha-checkbox-checked, .rc-anchor-checkbox-checked');
                    if (await checkmark.count() > 0) {
                      results.push(ok('reCAPTCHA solved — no image challenge needed', { status: 'verified' }));
                    } else {
                      results.push(warn('Checkbox clicked but verification unclear', { suggestion: 'Use "captcha-grid" to check for image challenge' }));
                    }
                  }
                } else {
                  results.push(warn('reCAPTCHA anchor frame found but checkbox element missing', { action: 'trying click on anchor body' }));
                  const anchor = checkboxFrame.locator('#recaptcha-anchor');
                  await humanClick(anchor, p).catch(() => {});
                  await p.waitForTimeout(3000);
                  results.push('Use "captcha-grid" to check for image challenge.');
                }
              } else {
                results.push(warn('No reCAPTCHA anchor frame found', { action: 'trying main page widget' }));
                const mainCheckbox = p.locator('.g-recaptcha, [data-sitekey]');
                if (await mainCheckbox.count() > 0) {
                  await humanClick(mainCheckbox, p);
                  await p.waitForTimeout(3000);
                  results.push('Clicked reCAPTCHA widget. Use "captcha-grid" if image challenge appeared.');
                } else {
                  results.push(err('reCAPTCHA widget not found on page', 'Check if the page has loaded or use "detect-captcha" first'));
                }
              }
            } catch (e: any) {
              results.push(err(`reCAPTCHA click failed: ${e.message}`, 'Use "detect-captcha" first, then retry "solve-captcha"'));
            }
          }

          if (captchaType === 'hcaptcha') {
            results.push('Attempting hCaptcha...');
            try {
              const checkboxFrame = hcaptchaCheckbox;
              if (checkboxFrame) {
                const checkbox = checkboxFrame.locator('#checkbox, .check');
                if (await checkbox.count() > 0) {
                  await p.waitForTimeout(800 + Math.random() * 1200);
                  await humanClick(checkbox, p);
                  await p.waitForTimeout(3000);

                  const updatedFrames = p.frames();
                  const challengeFrame = updatedFrames.find((f: any) => f.url().includes('hcaptcha') && f.url().includes('challenge'));
                  if (challengeFrame) {
                    results.push('Image challenge appeared. Auto-solving...');
                    const maxRetries = 3;
                    let solved = false;
                    for (let attempt = 0; attempt < maxRetries; attempt++) {
                      if (attempt > 0) results.push(`\nRetry attempt ${attempt}/${maxRetries - 1}...`);
                      const solveResult = await solveCaptchaGrid(p, challengeFrame, 'hcaptcha');
                      results.push(solveResult);

                      if (solveResult.includes('Captcha solved!')) {
                        solved = true;
                        break;
                      }

                      if (solveResult.includes('Falling back to manual mode')) {
                        break;
                      }

                      await p.waitForTimeout(2000);
                      const refreshedFrames = p.frames();
                      const newChallenge = refreshedFrames.find((f: any) => f.url().includes('hcaptcha') && f.url().includes('challenge'));
                      if (!newChallenge) {
                        results.push('Challenge frame disappeared, captcha may be solved');
                        solved = true;
                        break;
                      }
                    }
                    if (!solved && !results.some(r => r.includes('Falling back'))) {
                      results.push(`\nAuto-solve exhausted after ${maxRetries} attempts. Use "captcha-grid" and "click-tile" for manual solving.`);
                    }
                  } else {
                    const checkmark = checkboxFrame.locator('.check.solved, #checkbox[aria-checked="true"]');
                    if (await checkmark.count() > 0) {
                      results.push(ok('hCaptcha solved', { status: 'verified' }));
                    } else {
                      results.push(warn('hCaptcha checkbox clicked, status unclear', { suggestion: 'Use "captcha-grid" to check for image challenge' }));
                    }
                  }
                } else {
                  results.push(err('hCaptcha checkbox element not found in frame'));
                }
              } else {
                results.push(err('hCaptcha checkbox frame not found', 'Use "detect-captcha" to scan for captcha type'));
              }
            } catch (e: any) {
              results.push(err(`hCaptcha click failed: ${e.message}`));
            }
          }

          if (captchaType === 'turnstile') {
            results.push('Attempting Cloudflare Turnstile...');
            try {
              const turnstileFrame = frames.find(f => f.url().includes('challenges.cloudflare'));
              if (turnstileFrame) {
                await p.waitForTimeout(1500 + Math.random() * 1000);
                const cb = turnstileFrame.locator('input[type="checkbox"], .cb-lb');
                if (await cb.count() > 0) {
                  await humanClick(cb, p);
                  await p.waitForTimeout(3000);
                  results.push(ok('Turnstile checkbox clicked'));
                } else {
                  await turnstileFrame.locator('body').click();
                  await p.waitForTimeout(3000);
                  results.push(warn('Turnstile frame clicked (managed challenge)', { next: 'Check if challenge resolved with screenshot' }));
                }
              }
            } catch (e: any) {
              results.push(err(`Turnstile failed: ${e.message}`));
            }
          }

          if (captchaType === 'funcaptcha') {
            results.push('FunCaptcha (Arkose Labs) detected. Auto-solving...');
            try {
              const fcFrame = funcaptchaFrame;
              if (fcFrame) {
                await p.waitForTimeout(2000);

                const instruction = await fcFrame.evaluate(() => {
                  const h2 = document.querySelector('h2, h3, .challenge-title, #challenge-stage .title, [class*="instruction"], [class*="prompt"]');
                  return h2?.textContent?.trim() || '';
                }).catch(() => '');

                if (instruction) results.push(`Instruction: "${instruction}"`);

                const maxAttempts = 3;
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                  if (attempt > 0) results.push(`\nRetry ${attempt}/${maxAttempts - 1}...`);

                  const screenshotPath = join(homedir(), '.aurix-funcaptcha-puzzle.png');
                  try {
                    await fcFrame.locator('#challenge-stage, .challenge-content, .game-content, body').first().screenshot({ path: screenshotPath });
                  } catch {
                    await p.screenshot({ path: screenshotPath });
                  }

                  try {
                    const ssBase64 = readFileBase64(screenshotPath);
                    const prompt = instruction
                      ? `This is a FunCaptcha puzzle. The instruction is: "${instruction}". Analyze the image and tell me EXACTLY what to do. Reply in this format:\n- For clicking: "CLICK x,y" (pixel coordinates relative to the puzzle image)\n- For dragging: "DRAG fromX,fromY toX,toY"\n- For rotating: "ROTATE degrees" (estimated rotation angle in degrees)\n- For selecting an option: "CLICK x,y" on the correct answer\nBe precise with coordinates.`
                      : `This is a FunCaptcha puzzle. Analyze the image and determine what action is needed to solve it. Reply in this format:\n- For clicking: "CLICK x,y"\n- For dragging: "DRAG fromX,fromY toX,toY"\n- For rotating: "ROTATE degrees"\nBe precise with coordinates.`;

                    const visionResp = await visionClassify(ssBase64, prompt);
                    results.push(`Vision model: "${visionResp}"`);

                    const clickMatch = visionResp.match(/CLICK\s+([\d.]+)\s*,\s*([\d.]+)/i);
                    const dragMatch = visionResp.match(/DRAG\s+([\d.]+)\s*,\s*([\d.]+)\s+([\d.]+)\s*,\s*([\d.]+)/i);
                    const rotateMatch = visionResp.match(/ROTATE\s+(-?[\d.]+)/i);

                    const puzzleBox = await fcFrame.locator('#challenge-stage, .challenge-content, .game-content, body').first().boundingBox().catch(() => null);
                    const offsetX = puzzleBox?.x || 0;
                    const offsetY = puzzleBox?.y || 0;

                    if (clickMatch) {
                      const cx = offsetX + parseFloat(clickMatch[1]);
                      const cy = offsetY + parseFloat(clickMatch[2]);
                      await humanMove(cx, cy, p);
                      await p.waitForTimeout(100 + Math.random() * 150);
                      await p.mouse.down();
                      await p.waitForTimeout(60 + Math.random() * 80);
                      await p.mouse.up();
                      results.push(`Clicked at (${Math.round(cx)}, ${Math.round(cy)})`);
                      await p.waitForTimeout(2000);
                    } else if (dragMatch) {
                      const fromX = offsetX + parseFloat(dragMatch[1]);
                      const fromY = offsetY + parseFloat(dragMatch[2]);
                      const toX = offsetX + parseFloat(dragMatch[3]);
                      const toY = offsetY + parseFloat(dragMatch[4]);
                      await humanMove(fromX, fromY, p);
                      await p.waitForTimeout(150 + Math.random() * 200);
                      await p.mouse.down();
                      await p.waitForTimeout(200 + Math.random() * 300);
                      const steps = 20 + Math.floor(Math.random() * 15);
                      for (let i = 1; i <= steps; i++) {
                        const progress = i / steps;
                        const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                        await p.mouse.move(fromX + (toX - fromX) * eased, fromY + (toY - fromY) * eased + (Math.random() - 0.5) * 2);
                        await p.waitForTimeout(10 + Math.random() * 15);
                      }
                      await p.mouse.move(toX, toY);
                      await p.waitForTimeout(150);
                      await p.mouse.up();
                      results.push(`Dragged from (${Math.round(fromX)},${Math.round(fromY)}) to (${Math.round(toX)},${Math.round(toY)})`);
                      await p.waitForTimeout(2000);
                    } else if (rotateMatch) {
                      const degrees = parseFloat(rotateMatch[1]);
                      const rotator = fcFrame.locator('.rotator, [class*="rotate"], [class*="spinner"], canvas, .game-item').first();
                      if (await rotator.count() > 0) {
                        const rBox = await rotator.boundingBox();
                        if (rBox) {
                          const cx = rBox.x + rBox.width / 2;
                          const cy = rBox.y + rBox.height / 2;
                          const radius = rBox.width / 2;
                          const startX = cx + radius;
                          const startY = cy;
                          const endAngle = (degrees * Math.PI) / 180;
                          const endX = cx + radius * Math.cos(endAngle);
                          const endY = cy + radius * Math.sin(endAngle);
                          await humanMove(startX, startY, p);
                          await p.waitForTimeout(150);
                          await p.mouse.down();
                          await p.waitForTimeout(200);
                          const steps = 30;
                          for (let i = 1; i <= steps; i++) {
                            const angle = (endAngle * i) / steps;
                            await p.mouse.move(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
                            await p.waitForTimeout(15 + Math.random() * 10);
                          }
                          await p.mouse.move(endX, endY);
                          await p.waitForTimeout(150);
                          await p.mouse.up();
                          results.push(`Rotated ${degrees}°`);
                          await p.waitForTimeout(2000);
                        }
                      } else {
                        results.push('[WARN] No rotatable element found');
                      }
                    } else {
                      results.push(`Could not parse vision model response: "${visionResp}"`);
                      results.push('Falling back to manual mode. Read the puzzle screenshot and use click/drag-to/evaluate to solve.');
                      break;
                    }

                    const stillChallenge = await fcFrame.locator('#challenge-stage, .challenge-content').count();
                    const successIndicators = await fcFrame.locator('[class*="success"], [class*="correct"], [class*="verified"], .game-success').count();

                    if (successIndicators > 0) {
                      results.push('[OK] FunCaptcha solved!');
                      break;
                    }

                    if (stillChallenge === 0) {
                      results.push('[OK] FunCaptcha challenge dismissed — likely solved.');
                      break;
                    }

                    if (attempt === maxAttempts - 1) {
                      results.push(`Auto-solve exhausted after ${maxAttempts} attempts. Use click/drag-to/evaluate for manual solving.`);
                    } else {
                      results.push('Attempt did not solve, retrying...');
                      await p.waitForTimeout(1500);
                    }
                  } catch (e: any) {
                    results.push(`Vision model failed: ${e.message}`);
                    results.push('Auto-solve requires a vision-capable model. Read the puzzle screenshot at .aurix-funcaptcha-puzzle.png and use click/drag-to/evaluate to solve manually.');
                    break;
                  }
                }
              } else {
                results.push(err('FunCaptcha frame not found', 'Use "detect-captcha" to scan the page first'));
              }
            } catch (e: any) {
              results.push(err(`FunCaptcha auto-solve failed: ${e.message}`));
            }
          }

          if (captchaType === 'mtcaptcha' || captchaType === 'geetest') {
            results.push(`Detected ${captchaType} challenge. Analyzing...`);
            const targetFrame = mtcaptchaFrame || geetestFrame || p;

            const hasSlider = await targetFrame.locator('.geetest_slider_button, .geetest_slider, [class*="slider_button"], [class*="slider-track"]').count();
            if (hasSlider > 0) {
              results.push('Type: SLIDER puzzle');

              const puzzleEl = targetFrame.locator('.geetest_panel, .geetest_widget, [class*="geetest_container"]').first();
              const screenshotPath = join(homedir(), '.aurix-slider-puzzle.png');
              try {
                if (await puzzleEl.count() > 0) await puzzleEl.screenshot({ path: screenshotPath });
                else await p.screenshot({ path: screenshotPath });
              } catch { await p.screenshot({ path: screenshotPath }); }
              results.push(`Puzzle screenshot: ${screenshotPath}`);

              const maxAttempts = 3;
              for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (attempt > 0) results.push(`\nSlider retry ${attempt}/${maxAttempts - 1}...`);

                const sliderInfo = await targetFrame.evaluate(() => {
                  const info: Record<string, any> = {};
                  const cut = document.querySelector('.geetest_cut, .geetest_piece_bg, [class*="geetest_cut"], [class*="slider_cut"], [class*="puzzle-gap"]');
                  if (cut) {
                    const cutRect = cut.getBoundingClientRect();
                    const style = window.getComputedStyle(cut);
                    info.cut = { left: cutRect.left, width: cutRect.width, styleLeft: parseFloat(style.left) || null, transform: style.transform || null };
                  }
                  const bg = document.querySelector('.geetest_canvas_bg, .geetest_bg, [class*="geetest_canvas"], canvas[class*="bg"]');
                  if (bg) {
                    const bgRect = bg.getBoundingClientRect();
                    info.bg = { left: bgRect.left, width: bgRect.width };
                  }
                  const piece = document.querySelector('.geetest_piece, .geetest_slider_piece, [class*="slider_piece"]');
                  if (piece) {
                    const pieceRect = piece.getBoundingClientRect();
                    info.piece = { left: pieceRect.left, width: pieceRect.width };
                  }
                  const slider = document.querySelector('.geetest_slider_button, .geetest_slider_knob, [class*="slider_button"]');
                  if (slider) {
                    const sliderRect = slider.getBoundingClientRect();
                    info.slider = { left: sliderRect.left, width: sliderRect.width, centerX: sliderRect.left + sliderRect.width / 2, centerY: sliderRect.top + sliderRect.height / 2 };
                  }
                  const track = document.querySelector('.geetest_slider_track, .geetest_slider, [class*="slider_track"]');
                  if (track) info.track = { width: track.getBoundingClientRect().width };
                  return info;
                });

                let gapOffset: number | null = null;
                if (sliderInfo.cut && sliderInfo.bg) {
                  if (sliderInfo.cut.styleLeft && sliderInfo.cut.styleLeft > 0) {
                    gapOffset = Math.round(sliderInfo.cut.styleLeft);
                  } else {
                    gapOffset = Math.round(sliderInfo.cut.left - sliderInfo.bg.left);
                  }
                }
                if (gapOffset === null && sliderInfo.cut?.transform && sliderInfo.cut.transform !== 'none') {
                  const match = sliderInfo.cut.transform.match(/matrix\(.*?,\s*([\d.]+)/);
                  if (match) gapOffset = Math.round(parseFloat(match[1]));
                }

                if (gapOffset === null) {
                  results.push('DOM gap detection failed, using vision model...');
                  try {
                    const ssBase64 = readFileBase64(screenshotPath);
                    const visionResp = await visionClassify(ssBase64,
                      'This is a slider puzzle captcha. There is a gap/hole in the background image where a puzzle piece needs to go. Estimate the horizontal pixel position of the CENTER of the gap, measured from the LEFT edge of the puzzle image. Reply with ONLY the number (e.g. "145").');
                    const parsed = parseInt(visionResp.replace(/[^\d]/g, ''));
                    if (!isNaN(parsed) && parsed > 10 && parsed < 500) {
                      gapOffset = parsed;
                      results.push(`Vision model: gap at ~${gapOffset}px`);
                    } else {
                      results.push(`Vision model returned: "${visionResp}" — could not parse gap position`);
                    }
                  } catch (e: any) {
                    results.push(`Vision model failed: ${e.message}`);
                  }
                }

                if (gapOffset === null) {
                  results.push('[WARN] Could not determine gap position. Use "slider-analyze" for manual analysis, then "drag-to" to slide.');
                  break;
                }

                const pieceHalf = Math.round((sliderInfo.piece?.width || 44) / 2);
                const adjusted = gapOffset - pieceHalf;
                results.push(`Gap: ${gapOffset}px, piece half: ${pieceHalf}px, drag distance: ${adjusted}px`);

                if (sliderInfo.slider) {
                  try {
                    const startX = sliderInfo.slider.centerX;
                    const startY = sliderInfo.slider.centerY;
                    const endX = startX + adjusted;

                    await humanMove(startX, startY, p);
                    await p.waitForTimeout(150 + Math.random() * 250);
                    await p.mouse.down();
                    await p.waitForTimeout(200 + Math.random() * 300);

                    const steps = 25 + Math.floor(Math.random() * 20);
                    for (let i = 1; i <= steps; i++) {
                      const progress = i / steps;
                      const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                      const x = startX + adjusted * eased + (Math.random() - 0.5) * 2;
                      const y = startY + (Math.random() - 0.5) * 2;
                      await p.mouse.move(x, y);
                      await p.waitForTimeout(10 + Math.random() * 20);
                    }
                    await p.mouse.move(endX, startY);
                    await p.waitForTimeout(150);
                    await p.mouse.up();
                    await p.waitForTimeout(2000);

                    results.push('Slider dragged, checking result...');

                    const successEl = await targetFrame.locator('.geetest_success, .geetest_tip_success, [class*="success"], [class*="verified"]').count();
                    if (successEl > 0) {
                      results.push('[OK] Slider captcha solved!');
                      break;
                    }

                    const failEl = await targetFrame.locator('.geetest_fail, .geetest_tip_fail, [class*="fail"], [class*="error"], [class*="retry"]').count();
                    if (failEl > 0) {
                      results.push('Slider attempt failed, retrying...');
                      const refreshBtn = targetFrame.locator('.geetest_refresh, [class*="refresh"], [class*="retry"]').first();
                      if (await refreshBtn.count() > 0) await refreshBtn.click().catch(() => {});
                      await p.waitForTimeout(1500);
                      try {
                        if (await puzzleEl.count() > 0) await puzzleEl.screenshot({ path: screenshotPath });
                      } catch {}
                      continue;
                    }

                    results.push('[OK] Slider dragged — outcome unconfirmed, check page state.');
                    break;
                  } catch (e: any) {
                    results.push(`Drag failed: ${e.message}`);
                    break;
                  }
                } else {
                  results.push('[WARN] Slider handle not found in DOM.');
                  break;
                }
              }
            } else {
              results.push('Type: IMAGE challenge');
              const gridResult = await solveCaptchaGrid(p, targetFrame, captchaType);
              results.push(gridResult);
            }
          }

          if (captchaType === 'unknown') {
            const imgCaptcha = p.locator('img[src*="captcha"], #captcha-image, .captcha-image, img.captcha');
            if (await imgCaptcha.count() > 0) {
              results.push('Text-based captcha detected.');
              const screenshotPath = join(homedir(), '.aurix-captcha-challenge.png');
              await imgCaptcha.first().screenshot({ path: screenshotPath });
              results.push(`Captcha image saved: ${screenshotPath}`);

              try {
                const ssBase64 = readFileBase64(screenshotPath);
                const visionResp = await visionClassify(ssBase64,
                  'Read the text/numbers in this captcha image. Reply with ONLY the exact text shown, nothing else.');
                const captchaText = visionResp.replace(/[^a-zA-Z0-9]/g, '').trim();

                if (captchaText.length >= 2) {
                  const input = p.locator('input[name*="captcha"], input[id*="captcha"], input[placeholder*="captcha" i], input[placeholder*="code" i]');
                  if (await input.count() > 0) {
                    await input.first().click();
                    await input.first().fill('');
                    for (const char of captchaText) {
                      await input.first().type(char, { delay: 80 + Math.random() * 120 });
                    }
                    results.push(`[OK] Auto-filled captcha text: "${captchaText}"`);
                  } else {
                    results.push(`Vision model read: "${captchaText}" — but no captcha input field found. Use "fill" to type it manually.`);
                  }
                } else {
                  results.push(`Vision model returned: "${visionResp}" — could not read captcha text`);
                  results.push('Read the screenshot and use "fill" to type the captcha text manually.');
                }
              } catch (e: any) {
                results.push(`Vision auto-fill failed: ${e.message}`);
                results.push('Read the captcha screenshot and use "fill" to type it manually.');
              }
            } else {
              results.push('No recognizable captcha. Taking screenshot and scanning...');
              const screenshotPath = join(homedir(), '.aurix-captcha-challenge.png');
              await p.screenshot({ path: screenshotPath });
              results.push(`Screenshot saved: ${screenshotPath}`);
              results.push('Use "captcha-grid" to scan for any challenge overlay.');
            }
          }

          const screenshotPath = join(homedir(), '.aurix-captcha-after.png');
          await p.screenshot({ path: screenshotPath });
          results.push(`\nPost-attempt screenshot: ${screenshotPath}`);
          return results.join('\n');
        }

        case 'captcha-grid': {
          const p = await ensureBrowser();
          const frames = p.frames();

          let challengeFrame: any = null;
          let provider = 'unknown';

          for (const frame of frames) {
            const url = frame.url();
            if (url.includes('/recaptcha/') && url.includes('/bframe')) {
              challengeFrame = frame;
              provider = 'recaptcha';
              break;
            }
            if (url.includes('hcaptcha') && url.includes('challenge')) {
              challengeFrame = frame;
              provider = 'hcaptcha';
              break;
            }
            if (url.includes('mtcaptcha') || url.includes('service.mtcaptcha')) {
              challengeFrame = frame;
              provider = 'mtcaptcha';
              break;
            }
            if (url.includes('geetest') || url.includes('captcha.com')) {
              challengeFrame = frame;
              provider = 'geetest';
              break;
            }
          }

          if (!challengeFrame) {
            challengeFrame = p;
            const content = await p.content();
            if (content.includes('mtcaptcha')) provider = 'mtcaptcha';
            else if (content.includes('geetest')) provider = 'geetest';
            else provider = 'unknown';
          }

          const result = await analyzeImageChallenge(p, challengeFrame, provider);
          return result;
        }

        case 'click-tile': {
          const p = await ensureBrowser();
          const rawValue = (value || target || '0').toString();
          const tileIndices = rawValue.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
          const frames = p.frames();

          let challengeFrame: any = null;
          let provider = 'unknown';

          for (const frame of frames) {
            const url = frame.url();
            if (url.includes('/recaptcha/') && url.includes('/bframe')) {
              challengeFrame = frame;
              provider = 'recaptcha';
              break;
            }
            if (url.includes('hcaptcha') && url.includes('challenge')) {
              challengeFrame = frame;
              provider = 'hcaptcha';
              break;
            }
            if (url.includes('mtcaptcha') || url.includes('service.mtcaptcha')) {
              challengeFrame = frame;
              provider = 'mtcaptcha';
              break;
            }
          }

          if (!challengeFrame) challengeFrame = p;

          const initialTiles = await findGridTiles(challengeFrame, provider);
          if (initialTiles.length === 0) return err('No grid tiles found', 'Use "captcha-grid" to scan the challenge first');
          for (const idx of tileIndices) {
            if (idx < 0 || idx >= initialTiles.length) return err(`Tile index ${idx} out of range (0-${initialTiles.length - 1})`);
          }

          const isRecaptcha = provider === 'recaptcha';
          const selectedClass = isRecaptcha
            ? '.rc-imageselect-tileselected, .rc-imageselect-dynamic-selected, .rc-imageselect-tile.rc-imageselect-tileselected'
            : '.task-image.selected, .task .selected';

          let instruction = '';
          if (isRecaptcha) {
            try {
              const instrEl = challengeFrame.locator('.rc-imageselect-instructions, .prompt-text, .prompt-text-h');
              if (await instrEl.count() > 0) instruction = (await instrEl.first().textContent() || '').trim();
              if (!instruction) {
                const st = challengeFrame.locator('strong').first();
                if (await st.count() > 0) instruction = (await st.textContent() || '').trim();
              }
            } catch {}
          }

          const results: string[] = [];
          results.push(`Clicking ${tileIndices.length} tile(s): [${tileIndices.join(', ')}]`);

          for (const tileIndex of tileIndices) {
            try {
              const currentTiles = await findGridTiles(challengeFrame, provider);
              if (tileIndex >= currentTiles.length) {
                results.push(`  Tile ${tileIndex}: out of range (${currentTiles.length} tiles now), skipping`);
                continue;
              }

              const tile = currentTiles[tileIndex];
              const selectedBefore = await challengeFrame.locator(selectedClass).count().catch(() => 0);
              const tileBox = await tile.boundingBox();
              if (tileBox) {
                const clickX = tileBox.x + tileBox.width * (0.3 + Math.random() * 0.4);
                const clickY = tileBox.y + tileBox.height * (0.3 + Math.random() * 0.4);
                await humanMove(clickX, clickY, p);
                await p.waitForTimeout(80 + Math.random() * 120);
                await p.mouse.down();
                await p.waitForTimeout(60 + Math.random() * 100);
                await p.mouse.up();
              } else {
                await tile.click({ force: true });
              }
              await p.waitForTimeout(500 + Math.random() * 400);

              const selectedCount = await challengeFrame.locator(selectedClass).count().catch(() => 0);
              const clickStatus = selectedCount !== selectedBefore
                ? `selected (${selectedBefore} → ${selectedCount})`
                : `unchanged (${selectedCount})`;
              results.push(`  Tile ${tileIndex}: ${clickStatus}`);

              if (isRecaptcha) {
                await p.waitForTimeout(1500 + Math.random() * 1000);
                const newTiles = await findGridTiles(challengeFrame, provider);
                const afterPath = join(homedir(), `.aurix-tile-after-${tileIndex}.png`);
                try {
                  await challengeFrame.locator('.rc-imageselect-table-33, .rc-imageselect-table-44, table').first().screenshot({ path: afterPath }).catch(() => p.screenshot({ path: afterPath }));
                } catch {}

                if (tileIndex < newTiles.length && instruction) {
                  try {
                    await newTiles[tileIndex].screenshot({ path: afterPath });
                    const newBase64 = readFileBase64(afterPath);
                    const newResp = await visionClassify(newBase64, `Does this image contain ${instruction}? Reply YES or NO only.`);
                    if (newResp.toLowerCase().includes('yes')) {
                      const newTile = newTiles[tileIndex];
                      const newBox = await newTile.boundingBox();
                      if (newBox) {
                        const nx = newBox.x + newBox.width * (0.3 + Math.random() * 0.4);
                        const ny = newBox.y + newBox.height * (0.3 + Math.random() * 0.4);
                        await humanMove(nx, ny, p);
                        await p.waitForTimeout(80 + Math.random() * 120);
                        await p.mouse.down();
                        await p.waitForTimeout(60 + Math.random() * 100);
                        await p.mouse.up();
                        results.push(`  → Replacement tile ${tileIndex} also matched, clicked`);
                        await p.waitForTimeout(1500 + Math.random() * 1000);
                      }
                    } else {
                      results.push(`  → Replacement tile ${tileIndex} doesn't match`);
                    }
                  } catch {}
                }
              }
            } catch (e: any) {
              results.push(`  Tile ${tileIndex}: FAILED — ${e.message}`);
            }
          }

          if (isRecaptcha) {
            results.push('');
            results.push('Use "captcha-verify" when all matching tiles are clicked, or "captcha-grid" to re-analyze.');
          } else {
            const ss = await autoScreenshot(p, 'click-tile');
            results.push(`Screenshot: ${ss}`);
            results.push('Continue clicking matching tiles, then use "captcha-verify"');
          }
          return results.join('\n');
        }

        case 'captcha-verify': {
          const p = await ensureBrowser();
          const frames = p.frames();

          let challengeFrame: any = null;
          let provider = 'unknown';

          for (const frame of frames) {
            const url = frame.url();
            if (url.includes('/recaptcha/') && url.includes('/bframe')) {
              challengeFrame = frame;
              provider = 'recaptcha';
              break;
            }
            if (url.includes('hcaptcha') && url.includes('challenge')) {
              challengeFrame = frame;
              provider = 'hcaptcha';
              break;
            }
            if (url.includes('mtcaptcha') || url.includes('service.mtcaptcha')) {
              challengeFrame = frame;
              provider = 'mtcaptcha';
              break;
            }
          }

          if (!challengeFrame) challengeFrame = p;

          const timeSinceAnalyze = _lastGridAnalyzeTime > 0 ? Date.now() - _lastGridAnalyzeTime : 0;
          if (timeSinceAnalyze > 90_000 && _lastGridAnalyzeTime > 0) {
            const results: string[] = [];
            results.push(`[WARN] Grid was analyzed ${Math.round(timeSinceAnalyze / 1000)}s ago — challenge likely refreshed.`);
            results.push('Re-analyzing before verify...');
            try {
              const reAnalyze = await analyzeImageChallenge(p, challengeFrame, provider);
              results.push(reAnalyze);
            } catch {}
            return results.join('\n');
          }

          try {
            let verifyBtn = challengeFrame.locator('#recaptcha-verify-button, .rc-button-submit, .button-submit, [id*="verify"]');
            if (await verifyBtn.count() === 0) {
              verifyBtn = challengeFrame.locator('button:has-text("Verify"), button:has-text("Next"), button:has-text("Submit")');
            }
            if (await verifyBtn.count() === 0) {
              return err('No verify button found', 'Use "captcha-grid" to analyze the challenge first');
            }

            await humanClick(verifyBtn, p);
            await p.waitForTimeout(3000);

            const screenshotPath = join(homedir(), '.aurix-captcha-verify-result.png');

            const errorText = await challengeFrame.locator('.rc-imageselect-incorrect-response, .error-message, .incorrect').count();
            if (errorText > 0) {
              const errorMsg = await challengeFrame.locator('.rc-imageselect-incorrect-response, .error-message').first().textContent().catch(() => 'Incorrect answer');
              await p.screenshot({ path: screenshotPath });

              const results: string[] = [];
              results.push(`Verification failed: "${errorMsg}". Auto-retrying...`);

              const maxRetries = 3;
              for (let attempt = 0; attempt < maxRetries; attempt++) {
                results.push(`\nRetry ${attempt + 1}/${maxRetries}...`);
                await p.waitForTimeout(2000);

                const currentFrames = p.frames();
                const retryFrame = currentFrames.find((f: any) => {
                  const u = f.url();
                  return (u.includes('/recaptcha/') && u.includes('/bframe')) ||
                         (u.includes('hcaptcha') && u.includes('challenge'));
                });

                if (!retryFrame) {
                  results.push('Challenge frame gone — captcha may be solved');
                  await p.screenshot({ path: screenshotPath });
                  return results.join('\n');
                }

                const retryProvider = retryFrame.url().includes('hcaptcha') ? 'hcaptcha' : 'recaptcha';
                const solveResult = await solveCaptchaGrid(p, retryFrame, retryProvider);
                results.push(solveResult);

                if (solveResult.includes('Captcha solved!')) {
                  return results.join('\n');
                }
              }

              results.push(`\nAuto-retry exhausted after ${maxRetries} attempts. Use "captcha-grid" and "click-tile" for manual solving.`);
              return results.join('\n');
            }

            const newChallenge = await challengeFrame.locator('.rc-imageselect-instructions, .prompt-text').count();
            if (newChallenge > 0) {
              const instruction = await challengeFrame.locator('.rc-imageselect-instructions, .prompt-text').first().textContent().catch(() => '');
              await p.screenshot({ path: screenshotPath });

              const results: string[] = [];
              results.push(`New challenge appeared: "${instruction}". Auto-solving...`);

              const maxRetries = 3;
              for (let attempt = 0; attempt < maxRetries; attempt++) {
                if (attempt > 0) results.push(`\nRetry ${attempt}/${maxRetries - 1}...`);
                const currentFrames = p.frames();
                const retryFrame = currentFrames.find((f: any) => {
                  const u = f.url();
                  return (u.includes('/recaptcha/') && u.includes('/bframe')) ||
                         (u.includes('hcaptcha') && u.includes('challenge'));
                });
                if (!retryFrame) {
                  results.push('Challenge frame gone — captcha may be solved');
                  return results.join('\n');
                }
                const retryProvider = retryFrame.url().includes('hcaptcha') ? 'hcaptcha' : 'recaptcha';
                const solveResult = await solveCaptchaGrid(p, retryFrame, retryProvider);
                results.push(solveResult);
                if (solveResult.includes('Captcha solved!')) return results.join('\n');
                await p.waitForTimeout(2000);
              }

              results.push(`\nAuto-solve exhausted. Use "captcha-grid" and "click-tile" manually.`);
              return results.join('\n');
            }

            await p.screenshot({ path: screenshotPath });
            return ok('Verification submitted', {
              screenshot: screenshotPath,
              note: 'Check if the form/page progressed. If verification widget reappears, use "solve-captcha" again.',
            });
          } catch (e: any) {
            return err(`Verify failed: ${e.message}`, 'Use "solve-captcha" to retry automatically');
          }
        }

        case 'slider-analyze': {
          const p = await ensureBrowser();
          const results: string[] = [];

          const sliderInfo = await p.evaluate(() => {
            const info: Record<string, any> = {};

            const track = document.querySelector('.geetest_slider_track, .geetest_slider, [class*="slider_track"], [class*="slider-track"]');
            if (track) {
              const trackRect = track.getBoundingClientRect();
              info.track = { left: trackRect.left, width: trackRect.width, top: trackRect.top };
            }

            const cut = document.querySelector('.geetest_cut, .geetest_piece_bg, [class*="geetest_cut"], [class*="slider_cut"], [class*="puzzle-gap"], [class*="slider-gap"]');
            if (cut) {
              const cutRect = cut.getBoundingClientRect();
              const style = window.getComputedStyle(cut);
              info.cut = {
                left: cutRect.left,
                width: cutRect.width,
                styleLeft: parseFloat(style.left) || null,
                transform: style.transform || null,
              };
            }

            const bg = document.querySelector('.geetest_canvas_bg, .geetest_bg, [class*="geetest_canvas"], canvas[class*="bg"]');
            if (bg) {
              const bgRect = bg.getBoundingClientRect();
              info.bg = { left: bgRect.left, width: bgRect.width };
            }

            const piece = document.querySelector('.geetest_piece, .geetest_slider_piece, [class*="slider_piece"], [class*="puzzle-piece"]');
            if (piece) {
              const pieceRect = piece.getBoundingClientRect();
              info.piece = { left: pieceRect.left, width: pieceRect.width };
            }

            const slider = document.querySelector('.geetest_slider_button, .geetest_slider_knob, [class*="slider_button"], [class*="slider-handle"]');
            if (slider) {
              const sliderRect = slider.getBoundingClientRect();
              info.slider = { left: sliderRect.left, width: sliderRect.width, centerX: sliderRect.left + sliderRect.width / 2 };
            }

            info.canvasCount = document.querySelectorAll('canvas').length;
            info.allGeeTestClasses = Array.from(document.querySelectorAll('[class*="geetest"]')).slice(0, 20).map(el => {
              const r = el.getBoundingClientRect();
              return `${el.className?.toString().slice(0, 80)} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`;
            });

            return info;
          });

          const puzzleEl = p.locator('.geetest_panel, .geetest_widget, [class*="geetest_container"], [class*="slider_container"]').first();
          const screenshotPath = join(homedir(), '.aurix-slider-puzzle.png');
          try {
            if (await puzzleEl.count() > 0) {
              await puzzleEl.screenshot({ path: screenshotPath });
            } else {
              await p.screenshot({ path: screenshotPath });
            }
          } catch {
            await p.screenshot({ path: screenshotPath });
          }

          results.push(`Puzzle screenshot: ${screenshotPath}`);
          results.push('');

          let gapOffset: number | null = null;

          if (sliderInfo.cut && sliderInfo.bg) {
            const bgLeft = sliderInfo.bg.left;
            const cutStyleLeft = sliderInfo.cut.styleLeft;
            const cutRectLeft = sliderInfo.cut.left;

            if (cutStyleLeft && cutStyleLeft > 0) {
              gapOffset = Math.round(cutStyleLeft);
              results.push(`Gap position (from CSS left): ${gapOffset}px from puzzle left edge`);
            } else if (cutRectLeft && bgLeft) {
              gapOffset = Math.round(cutRectLeft - bgLeft);
              results.push(`Gap position (from rect): ${gapOffset}px from puzzle left edge`);
            }
          }

          if (gapOffset === null && sliderInfo.cut?.transform && sliderInfo.cut.transform !== 'none') {
            const match = sliderInfo.cut.transform.match(/matrix\(.*?,\s*([\d.]+)/);
            if (match) {
              gapOffset = Math.round(parseFloat(match[1]));
              results.push(`Gap position (from transform): ${gapOffset}px from puzzle left edge`);
            }
          }

          if (sliderInfo.slider) {
            results.push(`Slider handle: at x=${Math.round(sliderInfo.slider.left)}, width=${Math.round(sliderInfo.slider.width)}`);
          }
          if (sliderInfo.track) {
            results.push(`Slider track: width=${Math.round(sliderInfo.track.width)}px`);
          }

          if (gapOffset !== null && sliderInfo.piece) {
            const pieceHalfWidth = Math.round((sliderInfo.piece.width || 44) / 2);
            const adjustedOffset = gapOffset - pieceHalfWidth;
            results.push('');
            results.push(`[OK] Gap at ${gapOffset}px, piece half ${pieceHalfWidth}px, drag distance ${adjustedOffset}px`);
            gapOffset = adjustedOffset;
          } else if (gapOffset !== null) {
            results.push('');
            results.push(`[OK] Gap at ${gapOffset}px`);
          } else {
            results.push('');
            results.push('DOM gap detection failed, trying vision model...');
            try {
              const ssBase64 = readFileBase64(screenshotPath);
              const visionResp = await visionClassify(ssBase64,
                'This is a slider puzzle captcha. There is a gap/hole in the background image where a puzzle piece needs to go. Estimate the horizontal pixel position of the CENTER of the gap, measured from the LEFT edge of the puzzle image. Reply with ONLY the number (e.g. "145").');
              const parsed = parseInt(visionResp.replace(/[^\d]/g, ''));
              if (!isNaN(parsed) && parsed > 10 && parsed < 500) {
                gapOffset = parsed;
                results.push(`Vision model: gap at ~${gapOffset}px`);
              } else {
                results.push(`Vision model returned: "${visionResp}" — could not parse`);
              }
            } catch (e: any) {
              results.push(`Vision model failed: ${e.message}`);
            }
          }

          if (gapOffset !== null && sliderInfo.slider) {
            results.push('Auto-dragging slider...');
            try {
              const startX = sliderInfo.slider.centerX || (sliderInfo.slider.left + sliderInfo.slider.width / 2);
              const startY = sliderInfo.slider.centerY || (sliderInfo.slider.top + sliderInfo.slider.height / 2);
              const endX = startX + gapOffset;

              await humanMove(startX, startY, p);
              await p.waitForTimeout(150 + Math.random() * 250);
              await p.mouse.down();
              await p.waitForTimeout(200 + Math.random() * 300);

              const steps = 25 + Math.floor(Math.random() * 20);
              for (let i = 1; i <= steps; i++) {
                const progress = i / steps;
                const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                const x = startX + gapOffset * eased + (Math.random() - 0.5) * 2;
                const y = startY + (Math.random() - 0.5) * 2;
                await p.mouse.move(x, y);
                await p.waitForTimeout(10 + Math.random() * 20);
              }
              await p.mouse.move(endX, startY);
              await p.waitForTimeout(150);
              await p.mouse.up();
              await p.waitForTimeout(2000);
              results.push('[OK] Slider auto-dragged. Check page state to confirm.');
            } catch (e: any) {
              results.push(`Auto-drag failed: ${e.message}. Use: drag-to target=".geetest_slider_button" value="${gapOffset},0"`);
            }
          } else if (gapOffset === null) {
            results.push('Could not determine gap position. Use "drag-to" manually with estimated offset.');
          }

          if (sliderInfo.allGeeTestClasses?.length > 0) {
            results.push('');
            results.push('GeeTest DOM elements:');
            sliderInfo.allGeeTestClasses.forEach((c: string) => results.push(`  ${c}`));
          }

          return results.join('\n');
        }

        case 'signup-assist': {
          const p = await ensureBrowser();
          if (!value) return err('signup-assist requires value as JSON', 'Example: value=\'{"email":"user@mail.com","password":"Pass123!","firstName":"John","lastName":"Doe"}\'');

          let data: Record<string, string> = {};
          try { data = JSON.parse(value); } catch {
            const parts = value.split(',').map(s => s.trim());
            if (parts.length >= 2) {
              data.email = parts[0];
              data.password = parts[1];
              if (parts[2]) data.firstName = parts[2];
              if (parts[3]) data.lastName = parts[3];
            } else {
              return err('signup-assist: could not parse value', 'Use JSON: {"email":"...","password":"..."} or comma-separated: "email,password"');
            }
          }

          const results: string[] = [];
          results.push('=== SIGNUP ASSIST ===');
          results.push(`Provided: ${Object.keys(data).join(', ')}`);
          results.push('');

          const allFrames = [p, ...p.frames().filter(f => f !== p.mainFrame())];
          let activeFrame: any = p;

          for (const frame of allFrames) {
            const inputs = await frame.locator('input:visible, select:visible, textarea:visible').count();
            if (inputs > 0) { activeFrame = frame; break; }
          }
          results.push(`Active frame: ${activeFrame === p ? 'main page' : 'iframe'} (${await activeFrame.locator('input:visible, select:visible, textarea:visible').count()} fields)`);

          const fillField = async (selectors: string[], val: string, label: string): Promise<boolean> => {
            for (const sel of selectors) {
              try {
                const loc = activeFrame.locator(sel).first();
                if (await loc.count() > 0 && await loc.isVisible()) {
                  const cur = await loc.inputValue().catch(() => '');
                  if (cur && cur.length > 0) {
                    results.push(`  ✓ ${label}: already filled`);
                    return true;
                  }
                  try {
                    await loc.fill(val, { timeout: 3000 });
                  } catch {
                    await loc.click({ timeout: 3000 });
                    await loc.pressSequentially(val, { delay: 30, timeout: 10000 });
                  }
                  results.push(`  ✓ ${label}: filled`);
                  return true;
                }
              } catch {}
            }
            return false;
          };

          const clickField = async (selectors: string[], label: string): Promise<boolean> => {
            for (const sel of selectors) {
              try {
                const loc = activeFrame.locator(sel).first();
                if (await loc.count() > 0 && await loc.isVisible()) {
                  const checked = await loc.isChecked().catch(() => false);
                  if (checked) {
                    results.push(`  ✓ ${label}: already checked`);
                    return true;
                  }
                  await loc.click({ timeout: 3000 });
                  results.push(`  ✓ ${label}: clicked`);
                  return true;
                }
              } catch {}
            }
            return false;
          };

          const selectDropdown = async (selectors: string[], val: string, label: string): Promise<boolean> => {
            for (const sel of selectors) {
              try {
                const loc = activeFrame.locator(sel).first();
                if (await loc.count() > 0 && await loc.isVisible()) {
                  const tag = await loc.evaluate((el: HTMLElement) => el.tagName.toLowerCase()).catch(() => '');
                  if (tag === 'select') {
                    try {
                      await loc.selectOption({ label: val }, { timeout: 3000 });
                      results.push(`  ✓ ${label}: selected "${val}"`);
                      return true;
                    } catch {
                      try {
                        await loc.selectOption({ value: val }, { timeout: 3000 });
                        results.push(`  ✓ ${label}: selected value "${val}"`);
                        return true;
                      } catch {}
                    }
                  }
                  await loc.click({ timeout: 3000 });
                  await activeFrame.waitForTimeout(400);
                  const numVal = parseInt(val, 10);
                  const optSels = [
                    `[role="option"]:has-text("${val}")`,
                    `[role="listbox"] [role="option"]:has-text("${val}")`,
                    `li:has-text("${val}"):visible`,
                    `[data-value="${val}"]:visible`,
                  ];
                  if (!isNaN(numVal)) {
                    optSels.push(`[role="option"]:nth-child(${numVal})`);
                    optSels.push(`li:nth-child(${numVal}):visible`);
                  }
                  for (const os of optSels) {
                    try {
                      const opt = activeFrame.locator(os).first();
                      if (await opt.count() > 0 && await opt.isVisible()) {
                        await opt.click({ timeout: 2000 });
                        results.push(`  ✓ ${label}: selected "${val}" (dropdown)`);
                        return true;
                      }
                    } catch {}
                  }
                }
              } catch {}
            }
            return false;
          };

          results.push('');
          results.push('--- Filling fields ---');

          if (data.email) {
            await fillField([
              'input[type="email"]',
              'input[name*="email" i]', 'input[name*="Email"]',
              'input[name*="username" i]', 'input[name*="MemberName"]',
              'input[id*="email" i]', 'input[id*="username" i]',
              'input[placeholder*="email" i]', 'input[placeholder*="Email"]',
              'input[autocomplete="email"]', 'input[autocomplete="username"]',
              'input[name="loginfmt"]',
            ], data.email, 'Email');
          }

          if (data.password) {
            await fillField([
              'input[type="password"]',
              'input[name*="password" i]', 'input[name*="Password"]', 'input[name*="Passwd"]',
              'input[id*="password" i]', 'input[name*="pass" i]',
              'input[autocomplete="new-password"]', 'input[autocomplete="current-password"]',
            ], data.password, 'Password');
          }

          if (data.firstName) {
            await fillField([
              'input[name*="firstName" i]', 'input[name*="FirstName"]', 'input[name*="fname" i]',
              'input[id*="firstName" i]', 'input[id*="fname" i]',
              'input[autocomplete="given-name"]',
              'input[placeholder*="first name" i]', 'input[placeholder*="First"]',
              'input[name="NameInput"]',
            ], data.firstName, 'First name');
          }

          if (data.lastName) {
            await fillField([
              'input[name*="lastName" i]', 'input[name*="LastName"]', 'input[name*="lname" i]',
              'input[id*="lastName" i]', 'input[id*="lname" i]',
              'input[autocomplete="family-name"]',
              'input[placeholder*="last name" i]', 'input[placeholder*="Last"]',
              'input[name="LastName"]',
            ], data.lastName, 'Last name');
          }

          if (data.firstName && !data.lastName) {
            await fillField([
              'input[name*="name" i]', 'input[id*="name" i]',
              'input[autocomplete="name"]',
            ], data.firstName + ' User', 'Full name');
          }

          if (data.phone) {
            await fillField([
              'input[type="tel"]', 'input[name*="phone" i]', 'input[name*="Phone"]',
              'input[id*="phone" i]', 'input[autocomplete="tel"]',
              'input[placeholder*="phone" i]',
            ], data.phone, 'Phone');
          }

          const birthYear = data.birthYear || '2003';
          const birthMonth = data.birthMonth || 'January';
          const birthDay = data.birthDay || '15';

          await selectDropdown([
            'select[id*="BirthYear"]', 'select[name*="birthYear" i]', 'select[id*="year" i]',
            'select[name*="year" i]', 'select[aria-label*="year" i]', 'select[aria-label*="Birth"]',
          ], birthYear, 'Birth year');

          await selectDropdown([
            'select[id*="BirthMonth"]', 'select[name*="birthMonth" i]', 'select[id*="month" i]',
            'select[name*="month" i]', 'select[aria-label*="month" i]',
          ], birthMonth, 'Birth month');

          await selectDropdown([
            'select[id*="BirthDay"]', 'select[name*="birthDay" i]', 'select[id*="day" i]',
            'select[name*="day" i]', 'select[aria-label*="day" i]',
          ], birthDay, 'Birth day');

          await selectDropdown([
            'select[id*="Country"]', 'select[name*="country" i]',
            'select[aria-label*="country" i]', 'select[name*="Country"]',
          ], data.country || 'United States', 'Country');

          await fillField([
            'input[name*="username" i]', 'input[id*="username" i]',
            'input[placeholder*="username" i]', 'input[name*="Username"]',
          ], data.username || (data.email ? data.email.split('@')[0] + Math.floor(Math.random() * 999) : 'user' + Math.floor(Math.random() * 9999)), 'Username');

          await clickField([
            'input[type="checkbox"][name*="agree" i]',
            'input[type="checkbox"][name*="tos" i]',
            'input[type="checkbox"][name*="terms" i]',
            'input[type="checkbox"][name*="consent" i]',
            'input[type="checkbox"][name*="privacy" i]',
            'input[type="checkbox"][name*="policy" i]',
            'input[type="checkbox"][id*="agree" i]',
            'input[type="checkbox"][id*="terms" i]',
            'input[type="checkbox"][id*="consent" i]',
            'input[type="checkbox"][id*="privacy" i]',
            'input[type="checkbox"][aria-label*="agree" i]',
            'input[type="checkbox"][aria-label*="terms" i]',
            'input[type="checkbox"][aria-label*="consent" i]',
            'input[type="checkbox"][aria-label*="accept" i]',
            'label:has-text("agree") input[type="checkbox"]',
            'label:has-text("terms") input[type="checkbox"]',
            'label:has-text("accept") input[type="checkbox"]',
            'label:has-text("consent") input[type="checkbox"]',
            'label:has-text("privacy") input[type="checkbox"]',
            'label:has-text("I agree") input[type="checkbox"]',
            'label:has-text("I accept") input[type="checkbox"]',
            '[role="checkbox"][aria-checked="false"]',
            'div:has-text("I agree"):not(:has(div:has-text("I agree")))',
            'span:has-text("I agree"):not(:has(span:has-text("I agree")))',
          ], 'Terms/Agreement checkbox');

          await p.waitForTimeout(500);

          const hasCaptcha = p.frames().some(f => {
            const u = f.url();
            return u.includes('recaptcha') || u.includes('hcaptcha') || u.includes('funcaptcha') ||
              u.includes('arkoselabs') || u.includes('geetest') || u.includes('turnstile') ||
              u.includes('captcha') || u.includes('mtcaptcha');
          });

          if (hasCaptcha) {
            results.push('');
            results.push('--- Verification step detected ---');
            results.push('Attempting to complete automatically...');
            const solveResults = await autoSolveCaptcha(p);
            solveResults.forEach(r => results.push(`  ${r}`));

            const needsVision = solveResults.some(r => r.includes('VERIFICATION COMPLETION STEPS') || r.includes('REQUIRES_VISION'));
            const unconfirmed = solveResults.some(r => /unconfirmed|shows an error/i.test(r));
            if (needsVision) {
              results.push('');
              results.push('⚠ Verification widget analysis is above. Follow the VERIFICATION COMPLETION STEPS to complete it, then re-run signup-assist to continue.');
            } else if (unconfirmed) {
              results.push('Verification attempted but NOT confirmed — take a screenshot to check the widget passed before relying on submission.');
            } else {
              await p.waitForTimeout(2000);
              results.push('Verification confirmed. Continuing form submission...');
            }
          }

          const clicked = await clickField([
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Next")', 'button:has-text("next")',
            'button:has-text("Continue")', 'button:has-text("continue")',
            'button:has-text("Submit")', 'button:has-text("submit")',
            'button:has-text("Create")', 'button:has-text("create")',
            'button:has-text("Sign up")', 'button:has-text("sign up")',
            'button:has-text("Register")', 'button:has-text("register")',
            'button:has-text("Accept")', 'button:has-text("accept")',
            '#iSignupAction', '#signup-button', '#submit-btn',
            'button.fui-Button[type="button"]:visible',
          ], 'Submit/Next button');

          await p.waitForTimeout(2000);

          results.push('');
          results.push(`--- Result ---`);
          results.push(`URL: ${p.url()}`);
          results.push(`Title: ${await p.title()}`);

          const screenshotPath = join(homedir(), '.aurix-signup-result.png');
          await p.screenshot({ path: screenshotPath });
          results.push(`Screenshot: ${screenshotPath}`);

          const newInputs = await (async () => {
            for (const frame of [p, ...p.frames().filter(f => f !== p.mainFrame())]) {
              const count = await frame.locator('input:visible').count();
              if (count > 0) return count;
            }
            return 0;
          })();

          if (newInputs > 0) {
            results.push('');
            results.push(`${newInputs} input field(s) still visible — run signup-assist again with any remaining data`);
            results.push('Common next fields: password, first name, last name, birth date, phone');
          }

          return results.join('\n');
        }

        case 'signin-assist': {
          const p = await ensureBrowser();
          if (!value) return err('signin-assist requires value as JSON', 'Example: value=\'{"email":"user@mail.com","password":"Pass123!"}\'');

          let data: Record<string, string> = {};
          try { data = JSON.parse(value); } catch {
            const parts = value.split(',').map(s => s.trim());
            if (parts.length >= 2) {
              data.email = parts[0];
              data.password = parts[1];
            } else {
              return err('signin-assist: could not parse value', 'Use JSON: {"email":"...","password":"..."} or comma-separated: "email,password"');
            }
          }

          const results: string[] = [];
          results.push('=== SIGNIN ASSIST ===');

          const allFrames = [p, ...p.frames().filter(f => f !== p.mainFrame())];
          let activeFrame: any = p;
          for (const frame of allFrames) {
            const inputs = await frame.locator('input:visible').count();
            if (inputs > 0) { activeFrame = frame; break; }
          }
          results.push(`Active frame: ${activeFrame === p ? 'main page' : 'iframe'}`);

          const fillField = async (selectors: string[], val: string, label: string): Promise<boolean> => {
            for (const sel of selectors) {
              try {
                const loc = activeFrame.locator(sel).first();
                if (await loc.count() > 0 && await loc.isVisible()) {
                  const cur = await loc.inputValue().catch(() => '');
                  if (cur && cur.length > 0) {
                    results.push(`  ✓ ${label}: already filled`);
                    return true;
                  }
                  try {
                    await loc.fill(val, { timeout: 3000 });
                  } catch {
                    await loc.click({ timeout: 3000 });
                    await loc.pressSequentially(val, { delay: 30, timeout: 10000 });
                  }
                  results.push(`  ✓ ${label}: filled`);
                  return true;
                }
              } catch {}
            }
            return false;
          };

          const clickField = async (selectors: string[], label: string): Promise<boolean> => {
            for (const sel of selectors) {
              try {
                const loc = activeFrame.locator(sel).first();
                if (await loc.count() > 0 && await loc.isVisible()) {
                  const checked = await loc.isChecked().catch(() => false);
                  if (checked) {
                    results.push(`  ✓ ${label}: already checked`);
                    return true;
                  }
                  await loc.click({ timeout: 3000 });
                  results.push(`  ✓ ${label}: clicked`);
                  return true;
                }
              } catch {}
            }
            return false;
          };

          results.push('');
          results.push('--- Filling login ---');

          if (data.email) {
            await fillField([
              'input[type="email"]',
              'input[name*="email" i]', 'input[name*="Email"]',
              'input[name*="username" i]', 'input[name*="MemberName"]',
              'input[id*="email" i]', 'input[id*="username" i]',
              'input[placeholder*="email" i]', 'input[placeholder*="Email"]',
              'input[autocomplete="email"]', 'input[autocomplete="username"]',
              'input[name="loginfmt"]', 'input[name="login"]',
              'input[type="text"][name*="user" i]',
            ], data.email, 'Email/Username');
          }

          if (data.password) {
            await fillField([
              'input[type="password"]',
              'input[name*="password" i]', 'input[name*="Password"]', 'input[name*="Passwd"]',
              'input[id*="password" i]', 'input[name*="pass" i]',
              'input[autocomplete="current-password"]',
            ], data.password, 'Password');
          }

          await clickField([
            'input[type="checkbox"][name*="remember" i]',
            'input[type="checkbox"][id*="remember" i]',
            'label:has-text("remember") input[type="checkbox"]',
            'label:has-text("Keep me") input[type="checkbox"]',
            'label:has-text("Stay signed") input[type="checkbox"]',
          ], 'Remember me checkbox');

          await p.waitForTimeout(300);

          const hasCaptcha = p.frames().some(f => {
            const u = f.url();
            return u.includes('recaptcha') || u.includes('hcaptcha') || u.includes('funcaptcha') ||
              u.includes('arkoselabs') || u.includes('geetest') || u.includes('turnstile') ||
              u.includes('captcha') || u.includes('mtcaptcha');
          });

          if (hasCaptcha) {
            results.push('');
            results.push('--- Verification step detected ---');
            results.push('Attempting to complete automatically...');
            const solveResults = await autoSolveCaptcha(p);
            solveResults.forEach(r => results.push(`  ${r}`));

            const needsVision = solveResults.some(r => r.includes('VERIFICATION COMPLETION STEPS') || r.includes('REQUIRES_VISION'));
            const unconfirmed = solveResults.some(r => /unconfirmed|shows an error/i.test(r));
            if (needsVision) {
              results.push('');
              results.push('⚠ Verification widget analysis is above. Follow the VERIFICATION COMPLETION STEPS to complete it, then re-run signin-assist to continue.');
            } else if (unconfirmed) {
              results.push('Verification attempted but NOT confirmed — take a screenshot to check the widget passed before relying on login.');
            } else {
              await p.waitForTimeout(2000);
              results.push('Verification confirmed. Continuing login...');
            }
          }

          await clickField([
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Sign in")', 'button:has-text("sign in")',
            'button:has-text("Log in")', 'button:has-text("log in")',
            'button:has-text("Login")', 'button:has-text("login")',
            'button:has-text("Next")', 'button:has-text("next")',
            'button:has-text("Continue")', 'button:has-text("continue")',
            'button:has-text("Submit")',
            '#idSIButton9', '#loginButton', '#submitBtn',
            'button.fui-Button[type="button"]:visible',
            'a:has-text("Sign in")', 'a:has-text("Log in")',
          ], 'Login/Sign in button');

          await p.waitForTimeout(2000);

          results.push('');
          results.push(`--- Result ---`);
          results.push(`URL: ${p.url()}`);
          results.push(`Title: ${await p.title()}`);

          const screenshotPath = join(homedir(), '.aurix-signin-result.png');
          await p.screenshot({ path: screenshotPath });
          results.push(`Screenshot: ${screenshotPath}`);

          const has2FA = await (async () => {
            for (const frame of allFrames) {
              const otp = await frame.locator('input[name*="otp" i], input[name*="code" i], input[name*="verification" i], input[placeholder*="code" i], input[type="tel"]:visible').count();
              if (otp > 0) return true;
            }
            return false;
          })();

          if (has2FA) {
            results.push('');
            results.push('2FA/OTP field detected — enter the verification code when available');
            results.push('Use: fill target="input[name*=\\"code\\"]" value="<code>"');
          }

          return results.join('\n');
        }

        case 'drag-to': {
          const p = await ensureBrowser();
          if (!target) return err('drag-to requires a target (source element or CSS selector)', 'Example: target=".slider-handle" value="200,0" or target="#puzzle-piece" value=".drop-zone"');
          if (!value) return err('drag-to requires a value (offset "x,y" or target element selector)', 'Offset: "200,0" for 200px right. Element: ".drop-zone" to drag to another element.');

          try {
            const sourceEl = p.locator(target).first();
            const sourceBox = await sourceEl.boundingBox();
            if (!sourceBox) return err(`Source element "${target}" not found or not visible`);

            const startX = sourceBox.x + sourceBox.width * (0.3 + Math.random() * 0.4);
            const startY = sourceBox.y + sourceBox.height * (0.3 + Math.random() * 0.4);

            let endX: number, endY: number;

            const coords = value.split(',').map(s => parseInt(s.trim()));
            if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
              endX = startX + coords[0];
              endY = startY + coords[1];
            } else {
              const targetEl = p.locator(value).first();
              const targetBox = await targetEl.boundingBox();
              if (!targetBox) return err(`Target element "${value}" not found or not visible`);
              endX = targetBox.x + targetBox.width * (0.3 + Math.random() * 0.4);
              endY = targetBox.y + targetBox.height * (0.3 + Math.random() * 0.4);
            }

            await warmupBehavior(p);

            await humanMove(startX, startY, p);
            await p.waitForTimeout(150 + Math.random() * 250);

            await p.mouse.down();
            await p.waitForTimeout(200 + Math.random() * 300);

            const distance = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
            const numControls = distance > 200 ? 3 : 2;
            const dragPoints: [number, number][] = [[startX, startY]];
            for (let i = 0; i < numControls; i++) {
              const frac = (i + 1) / (numControls + 1);
              const perpX = -(endY - startY) / distance;
              const perpY = (endX - startX) / distance;
              const offset = (Math.random() - 0.5) * Math.min(distance * 0.15, 40);
              const cx = startX + (endX - startX) * frac + perpX * offset;
              const cy = startY + (endY - startY) * frac + perpY * offset;
              dragPoints.push([cx, cy]);
            }
            dragPoints.push([endX, endY]);

            const dragSteps = 25 + Math.floor(Math.random() * 20);
            for (let step = 0; step <= dragSteps; step++) {
              const rawT = step / dragSteps;
              const t = easeInOut(rawT);
              const [px, py] = bezierPoint(t, dragPoints);

              const tremor = Math.sin(step * 0.35 + Math.random() * 0.5) * 0.5;
              const tremorY = Math.cos(step * 0.3 + Math.random() * 0.5) * 0.4;

              await p.mouse.move(px + tremor, py + tremorY);

              const speedFactor = 1 - Math.abs(rawT - 0.5) * 2;
              const delay = 10 + Math.random() * 15 + speedFactor * 8;
              await p.waitForTimeout(delay);
            }

            if (Math.random() > 0.5) {
              const overX = endX + (Math.random() - 0.5) * 6;
              const overY = endY + (Math.random() - 0.5) * 6;
              await p.mouse.move(overX, overY);
              await p.waitForTimeout(40 + Math.random() * 60);
              await p.mouse.move(endX, endY);
              await p.waitForTimeout(30 + Math.random() * 50);
            }

            await p.waitForTimeout(80 + Math.random() * 150);
            await p.mouse.move(endX + (Math.random() - 0.5) * 2, endY - 1 - Math.random());
            await p.waitForTimeout(30 + Math.random() * 40);
            await p.mouse.up();
            await p.waitForTimeout(400 + Math.random() * 300);

            const screenshotPath = join(homedir(), '.aurix-drag-result.png');
            await p.screenshot({ path: screenshotPath });

            return ok(`Dragged "${target}" to (${Math.round(endX)}, ${Math.round(endY)})`, {
              from: `(${Math.round(startX)}, ${Math.round(startY)})`,
              to: `(${Math.round(endX)}, ${Math.round(endY)})`,
              offset: `${Math.round(endX - startX)}, ${Math.round(endY - startY)}`,
              screenshot: screenshotPath,
            });
          } catch (e: any) {
            return err(`Drag failed: ${e.message}`, 'Check if the element exists with "snapshot"');
          }
        }

        case 'hold-click': {
          const p = await ensureBrowser();
          if (!target) return err('hold-click requires a target element');

          const baseDuration = Math.min(parseInt(value) || 5000, 12000);
          const duration = Math.max(2000, baseDuration + Math.floor(Math.random() * 2000) - 1000);
          try {
            const el = p.locator(target).first();
            const box = await el.boundingBox();
            if (!box) return err(`Element "${target}" not found or not visible`);

            const x = box.x + box.width / 2 + (Math.random() - 0.5) * box.width * 0.3;
            const y = box.y + box.height / 2 + (Math.random() - 0.5) * box.height * 0.3;

            // Pre-interaction warmup: move mouse around naturally
            await warmupBehavior(p);

            // Bezier curve approach to target
            await humanMove(x, y, p);
            await p.waitForTimeout(100 + Math.random() * 200);

            // Human-like hold with breathing movements
            await humanHold(x, y, duration, p);
            await p.waitForTimeout(300 + Math.random() * 400);

            const screenshotPath = join(homedir(), '.aurix-hold-result.png');
            await p.screenshot({ path: screenshotPath });

            return ok(`Held click on "${target}" for ${Math.round(duration)}ms (human-like)`, {
              position: `(${Math.round(x)}, ${Math.round(y)})`,
              screenshot: screenshotPath,
            });
          } catch (e: any) {
            return err(`Hold-click failed: ${e.message}`, 'Check if the element exists with "snapshot"');
          }
        }

        default:
          return err(`Unknown action: "${action}"`, `Available: navigate, click, fill, type, screenshot, snapshot, text, html, url, title, scroll, back, forward, press-key, select, wait, evaluate, new-tab, switch-tab, close-tab, open-tabs, cookies, upload, signup-assist, signin-assist, set-proxy, set-ui, detect-captcha, solve-captcha, captcha-grid, click-tile, captcha-verify, slider-analyze, drag-to, hold-click, close, status`);
      }
    } catch (e: any) {
      const msg = e.message || String(e);
      if (msg.includes('Timeout') || msg.includes('timeout')) {
        return err(`Timeout waiting for element or page load: ${msg.slice(0, 120)}`, 'Use "wait" to wait for page load, "snapshot" to check current state, or verify the element exists');
      }
      if (msg.includes('strict mode') || msg.includes('more than one')) {
        return err(`Multiple elements matched "${target || '(unknown)'}"`, 'Use a more specific selector (CSS #id, [attr]), or .first()/.nth(0)');
      }
      if (msg.includes('not visible') || msg.includes('element is not visible')) {
        return err(`Element "${target || '(unknown)'}" is not visible on the page`, 'Scroll to the element, wait for it to appear, or use "evaluate" for JS-based interaction');
      }
      if (msg.includes('detached') || msg.includes('was removed')) {
        return err(`Element was removed from the page during interaction`, 'The page updated while interacting. Use "snapshot" to get fresh elements and retry');
      }
      if (msg.includes('intercepts pointer') || msg.includes('overlapped')) {
        return err(`Another element is covering "${target || '(unknown)'}"`, 'Use "evaluate" with JavaScript click: document.querySelector(selector).click(), or scroll to reveal the element');
      }
      if (msg.includes('frame was detached') || msg.includes('Frame was detached')) {
        return err('The iframe was detached or reloaded during interaction', 'Re-detect frames with "detect-captcha" or "snapshot" and retry');
      }
      if (msg.includes('Navigation') || msg.includes('navigated')) {
        return err(`Page navigation interrupted the action: ${msg.slice(0, 120)}`, 'Wait for navigation to complete with "wait" action, then retry');
      }
      if (msg.includes('closed') || msg.includes('Target closed') || msg.includes('browser has been closed')) {
        return err('Browser or page was closed unexpectedly', 'Re-open the browser with action="navigate" to the target URL');
      }
      if (msg.includes('net::') || msg.includes('ERR_')) {
        return err(`Network error: ${msg.slice(0, 150)}`, 'Check internet connection, proxy settings (action="set-proxy"), or if the URL is accessible');
      }
      if (msg.includes('Execution context was destroyed')) {
        return err('Page JavaScript context was destroyed (page navigated or reloaded)', 'Use "wait" to let the page settle, then "snapshot" to check state before retrying');
      }
      return err(`Browser error: ${msg.slice(0, 200)}`, 'Use "snapshot" to check current page state, or "screenshot" to see what the page looks like');
    }
  },
};
