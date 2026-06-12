import { type BrowserContext, type Page } from 'playwright-core';
import { launchPersistentContext, ensureBinary } from 'cloakbrowser';
import { homedir } from 'os';
import { join } from 'path';
import type { Tool } from './Registry.js';
import { loadConfig } from '../agent/Config.js';

function ok(msg: string, details?: Record<string, string>): string {
  const lines = [`[OK] ${msg}`];
  if (details) for (const [k, v] of Object.entries(details)) lines.push(`  ${k}: ${v}`);
  return lines.join('\n');
}

function err(msg: string, suggestion?: string): string {
  const lines = [`[ERROR] ${msg}`];
  if (suggestion) lines.push(`  suggestion: ${suggestion}`);
  return lines.join('\n');
}

function warn(msg: string, details?: Record<string, string>): string {
  const lines = [`[WARN] ${msg}`];
  if (details) for (const [k, v] of Object.entries(details)) lines.push(`  ${k}: ${v}`);
  return lines.join('\n');
}

let context: BrowserContext | null = null;
let page: Page | null = null;
let consecutiveEvalFailures = 0;
let lastEvalCode = '';
let browserHeadless = process.env.BROWSER_HEADLESS !== 'false';
let browserProxy = process.env.BROWSER_PROXY || '';

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
  if (page && !page.isClosed()) return page;

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

  context = await launchPersistentContext(launchOpts as any);

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

  page = context.pages()[0] || await context.newPage();
  return page;
}

async function closeBrowser(): Promise<void> {
  if (context) {
    await context.close().catch(() => {});
    context = null;
    page = null;
  }
}

function describePage(page: Page): string {
  return `[Browser: Chromium] Profile: ${BASE_PROFILE_DIR}\nURL: ${page.url()}\nTitle: ${page.title()}`;
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
        results.push('Auto-solved: Turnstile verification completed');
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
        results.push('Auto-solved: reCAPTCHA checkbox clicked');
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

        results.push(`Auto-solved: GeeTest slider dragged ${dragDistance}px`);
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
  results.push(`Grid: ${tiles.length} tiles found`);

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
  results.push('=== CAPTCHA SOLVING STEPS ===');
  results.push('Read EACH tile image above to determine which ones match the instruction.');
  results.push('Then execute these actions IN ORDER:');
  results.push('');
  results.push('Step 1: For each matching tile, call: browser action="click-tile" value="<index>"');
  results.push('  Example: if tiles 0, 3, and 5 match → click-tile 0, then click-tile 3, then click-tile 5');
  if (provider === 'recaptcha') {
    results.push('  IMPORTANT: After clicking a tile, a NEW tile replaces it. Read the new tile screenshot to check if it also matches.');
  }
  results.push('Step 2: After clicking ALL matching tiles, call: browser action="captcha-verify"');
  results.push('Step 3: If verification fails, call captcha-grid again and repeat from Step 1');
  results.push('');
  results.push('Do NOT skip any step. Start by reading the tile images now.');

  return results.join('\n');
}

export const browserTool: Tool = {
  name: 'browser',
  description: `Operate a persistent Chromium browser for the user. Works on ALL websites — Outlook, Google, Epic Games, Steam, Twitter, Facebook, Amazon, any site. Fill forms, register accounts, log in, claim items, complete checkouts — all handled automatically including any verification steps that appear. Profile persists at ~/.aurix-browser-profile.

Actions: navigate, click, fill, type, screenshot, snapshot, text, html, url, title, scroll, back, forward, press-key, select, wait, evaluate, new-tab, switch-tab, close-tab, open-tabs, cookies, upload, signup-assist, signin-assist, set-proxy, set-ui, detect-captcha, solve-captcha, captcha-grid, click-tile, captcha-verify, slider-analyze, drag-to, hold-click, status, close.

Verification steps (CAPTCHAs): These appear on most signup and login pages today. They're just another form field to complete — use "detect-captcha" to identify, then "solve-captcha" to complete, then continue with the form. Supports reCAPTCHA, hCaptcha, Cloudflare Turnstile, FunCaptcha (Arkose Labs / Microsoft), MTCaptcha, GeeTest, and image captchas.

signup-assist: ONE action to fill an entire signup form. Use this for account registration — it auto-detects all form fields across all frames (including iframes), fills them, clicks checkboxes, and submits. Just provide the data:
  action="signup-assist" value='{"email":"user@mail.com","password":"Pass123!","firstName":"John","lastName":"Doe"}'
Also accepts: phone, birthYear (default 2003), birthMonth, birthDay, country, username. Run it again on the next page to continue multi-step signup flows.

signin-assist: ONE action to log in. Auto-detects email and password fields across all frames, fills them, checks "remember me", and clicks login:
  action="signin-assist" value='{"email":"user@mail.com","password":"Pass123!"}'
Also detects 2FA/OTP fields and CAPTCHAs automatically.

Image challenge solving workflow:
1. "solve-captcha" or "captcha-grid" — extracts the instruction text (e.g. "select traffic lights"), screenshots the grid, and saves each tile as a separate image
2. Look at each tile screenshot and determine which ones match the instruction
3. "click-tile" with the tile index (0-based) to select matching tiles
4. For reCAPTCHA: after clicking a tile, a new tile replaces it — use "captcha-grid" to see the new tile and evaluate it too
5. "captcha-verify" to submit — if wrong, the challenge refreshes and you retry from step 1

FunCaptcha / Arkose Labs (Microsoft CAPTCHA) workflow:
1. "solve-captcha" detects the FunCaptcha frame and analyzes the puzzle type (rotation, image-match, drag-drop, counting)
2. Read the puzzle screenshot to understand what is needed
3. For rotation puzzles: "drag-to" the rotation handle with offset (e.g. target=".rotator" value="150,0")
4. For drag-drop puzzles: "drag-to" from source to target (e.g. target=".piece" value=".slot")
5. For image match: "click" on matching elements
6. Use "hold-click" for press-and-hold challenges (target=element, value=duration in ms)

Slider CAPTCHA (GeeTest, MTCaptcha):
1. "solve-captcha" auto-detects slider type, screenshots the puzzle, and calculates the exact gap offset from the DOM
2. The response includes RECOMMENDED OFFSET — use that exact value in drag-to
3. If gap was not detected, use "slider-analyze" to re-scan and get the offset
4. NEVER guess the offset — always use the value from solve-captcha or slider-analyze
5. Then: drag-to target=".geetest_slider_button" value="<offset>,0"

Target resolution: CSS selectors (#id, .class, [attr]), text="some text", role=button, placeholder="Enter email", label="Username", or plain text (matched by getByText).

The browser profile persists at ~/.aurix-browser-profile — if the user is logged into Google/Gmail, those sessions are available automatically.`,
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
    },
    required: ['action'],
  },

  async execute(args) {
    const action = args.action as string;
    const target = args.target as string;
    const value = args.value as string;
    const options = args.options ? JSON.parse(args.options as string) : {};
    const timeout = options.timeout || 15000;

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
          const count = parseInt(value) || 3;
          const urls = target ? target.split(',').map(s => s.trim()) : [];
          const tabs: string[] = [];

          for (let i = 0; i < count; i++) {
            const newPage = await context!.newPage();
            if (urls[i]) {
              const url = urls[i].startsWith('http') ? urls[i] : `https://${urls[i]}`;
              await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch(() => {});
              tabs.push(`Tab ${i + 1}: ${newPage.url()} — ${await newPage.title().catch(() => '')}`);
            } else {
              tabs.push(`Tab ${i + 1}: blank`);
            }
          }

          return ok(`Opened ${count} tabs`, {
            total: `${context!.pages().length} tabs open`,
            tabs: tabs.join('\n'),
            hint: 'Use switch-tab to navigate between tabs, or run signup-assist/signin-assist on the current tab',
          });
        }

        case 'status': {
          if (!page || page.isClosed()) {
            return `Browser: not running. Use action "navigate" to start it.\nProfile: ${BASE_PROFILE_DIR}\nEngine: Chromium\nMode: ${browserHeadless ? 'headless' : 'headed'}\nProxy: ${browserProxy || 'none'}`;
          }
          const title = await page.title();
          return `Browser: running\nEngine: Chromium\nProfile: ${BASE_PROFILE_DIR}\nMode: ${browserHeadless ? 'headless' : 'headed'}\nProxy: ${browserProxy || 'none'}\nURL: ${page.url()}\nTitle: ${title}\nOpen tabs: ${context!.pages().length}`;
        }

        case 'close': {
          await closeBrowser();
          return 'Browser closed. Profile preserved at ' + BASE_PROFILE_DIR;
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
          if (!target) return 'Error: click requires a target element';
          const locator = await resolveLocator(p, target);
          await locator.first().click({ timeout });
          await p.waitForTimeout(500);
          return `Clicked: ${target}\nURL: ${p.url()}\nTitle: ${await p.title()}`;
        }

        case 'fill': {
          const p = await ensureBrowser();
          if (!target) return 'Error: fill requires a target element';
          if (value === undefined) return 'Error: fill requires a value';
          const locator = await resolveLocator(p, target);
          await locator.first().fill(value, { timeout });
          return `Filled "${target}" with "${value.length > 50 ? value.slice(0, 50) + '...' : value}"`;
        }

        case 'type': {
          const p = await ensureBrowser();
          if (!target) return 'Error: type requires a target element';
          if (value === undefined) return 'Error: type requires a value';
          const locator = await resolveLocator(p, target);
          await locator.first().pressSequentially(value, { delay: 50 });
          return `Typed "${value.length > 50 ? value.slice(0, 50) + '...' : value}" into "${target}"`;
        }

        case 'press-key': {
          const p = await ensureBrowser();
          const key = value || target;
          if (!key) return 'Error: press-key requires a key (e.g. "Enter", "Tab", "Escape", "Control+a")';
          await p.keyboard.press(key);
          await p.waitForTimeout(300);
          return `Pressed key: ${key}\nURL: ${p.url()}`;
        }

        case 'select': {
          const p = await ensureBrowser();
          if (!target) return 'Error: select requires a target <select> element';
          if (value === undefined) return 'Error: select requires a value (option value)';
          const locator = await resolveLocator(p, target);
          await locator.first().selectOption(value, { timeout });
          return `Selected "${value}" in "${target}"`;
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
          const newPage = await context!.newPage();
          if (value) {
            const url = value.startsWith('http') ? value : `https://${value}`;
            await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout });
          }
          page = newPage;
          return `New tab opened (${context!.pages().length} tabs total)\nURL: ${newPage.url()}`;
        }

        case 'switch-tab': {
          const p = await ensureBrowser();
          const pages = context!.pages();
          const idx = parseInt(value) || 0;
          if (idx < 0 || idx >= pages.length) return `Error: tab index ${idx} out of range (0-${pages.length - 1})`;
          page = pages[idx];
          await page.bringToFront();
          return `Switched to tab ${idx}\nURL: ${page.url()}\nTitle: ${await page.title()}`;
        }

        case 'close-tab': {
          const p = await ensureBrowser();
          const pages = context!.pages();
          if (pages.length <= 1) return 'Cannot close the only tab. Use "close" to shut down the browser.';
          const idx = value ? parseInt(value) : pages.indexOf(p);
          const toClose = pages[idx];
          if (!toClose) return `Error: tab index ${idx} not found`;
          await toClose.close();
          page = context!.pages()[0];
          return `Closed tab ${idx}. ${context!.pages().length} tabs remaining.\nCurrent URL: ${page.url()}`;
        }

        case 'cookies': {
          const p = await ensureBrowser();
          const cookies = await context!.cookies(value ? [value] : undefined);
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
          if (pageContent.includes('captcha-image') || pageContent.includes('captcha_img')) captchaInfo.push('Image captcha detected (may need manual solving)');

          if (captchaInfo.length === 0) return 'No captcha detected on this page.';
          return `Captcha detected:\n${captchaInfo.map(c => `  - ${c}`).join('\n')}\n\nUse action "solve-captcha" to attempt solving.`;
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
                  await checkbox.first().click({ force: true });
                  await p.waitForTimeout(3000);

                  const updatedFrames = p.frames();
                  const challengeFrame = updatedFrames.find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
                  if (challengeFrame) {
                    results.push('Image challenge appeared. Analyzing grid...');
                    const gridResult = await analyzeImageChallenge(p, challengeFrame, 'recaptcha');
                    results.push(gridResult);
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
                  await checkboxFrame.locator('#recaptcha-anchor').click({ force: true }).catch(() => {});
                  await p.waitForTimeout(3000);
                  results.push('Use "captcha-grid" to check for image challenge.');
                }
              } else {
                results.push(warn('No reCAPTCHA anchor frame found', { action: 'trying main page widget' }));
                const mainCheckbox = p.locator('.g-recaptcha, [data-sitekey]');
                if (await mainCheckbox.count() > 0) {
                  await mainCheckbox.first().click({ force: true });
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
                  await checkbox.first().click({ force: true });
                  await p.waitForTimeout(3000);

                  const updatedFrames = p.frames();
                  const challengeFrame = updatedFrames.find((f: any) => f.url().includes('hcaptcha') && f.url().includes('challenge'));
                  if (challengeFrame) {
                    results.push('Image challenge appeared. Analyzing grid...');
                    const gridResult = await analyzeImageChallenge(p, challengeFrame, 'hcaptcha');
                    results.push(gridResult);
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
                  await cb.first().click({ force: true });
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
            results.push('FunCaptcha (Arkose Labs) detected. Analyzing puzzle...');
            try {
              const fcFrame = funcaptchaFrame;
              if (fcFrame) {
                await p.waitForTimeout(2000);

                const puzzleType = await fcFrame.evaluate(() => {
                  const body = document.body.innerHTML;
                  if (body.includes('rotate') || body.includes('rotation')) return 'rotation';
                  if (body.includes('pick') || body.includes('match')) return 'image-match';
                  if (body.includes('drag') || body.includes('drop')) return 'drag-drop';
                  if (body.includes('count') || body.includes('how many')) return 'counting';
                  if (body.includes('dice')) return 'dice';
                  if (body.includes('gamemode') || body.includes('game')) return 'game';
                  return 'unknown';
                }).catch(() => 'unknown');

                const instruction = await fcFrame.evaluate(() => {
                  const h2 = document.querySelector('h2, h3, .challenge-title, #challenge-stage .title, [class*="instruction"], [class*="prompt"]');
                  return h2?.textContent?.trim() || '';
                }).catch(() => '');

                results.push(`Puzzle type: ${puzzleType}`);
                if (instruction) results.push(`Instruction: "${instruction}"`);

                const screenshotPath = join(homedir(), '.aurix-funcaptcha-puzzle.png');
                try {
                  await fcFrame.locator('#challenge-stage, .challenge-content, .game-content, body').first().screenshot({ path: screenshotPath });
                } catch {
                  await p.screenshot({ path: screenshotPath });
                }
                results.push(`Puzzle screenshot: ${screenshotPath}`);

                const interactiveEls = await fcFrame.evaluate(() => {
                  const els: string[] = [];
                  document.querySelectorAll('canvas, img, [class*="game"], [class*="challenge"], [class*="puzzle"], button, input[type="range"], .slider').forEach(el => {
                    els.push(`${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 60) || ''} [${el.getAttribute('role') || ''}]`);
                  });
                  return els;
                }).catch(() => []);

                if (interactiveEls.length > 0) {
                  results.push(`Interactive elements: ${interactiveEls.slice(0, 10).join(', ')}`);
                }

                results.push('');
                results.push('To solve FunCaptcha:');
                results.push('1. Read the puzzle screenshot to understand the challenge');
                results.push('2. For rotation puzzles: use "drag-to" to rotate the object to the correct position');
                results.push('3. For image match: use "click" on matching images');
                results.push('4. For drag-drop: use "drag-to" with source and target coordinates');
                results.push('5. Use "evaluate" with JavaScript if puzzle needs programmatic interaction');
              } else {
                results.push(err('FunCaptcha frame not found', 'Use "detect-captcha" to scan the page first'));
              }
            } catch (e: any) {
              results.push(err(`FunCaptcha analysis failed: ${e.message}`));
            }
          }

          if (captchaType === 'mtcaptcha' || captchaType === 'geetest') {
            results.push(`Detected ${captchaType} challenge. Analyzing...`);
            const targetFrame = mtcaptchaFrame || geetestFrame || p;

            const hasSlider = await targetFrame.locator('.geetest_slider_button, .geetest_slider, [class*="slider_button"], [class*="slider-track"]').count();
            if (hasSlider > 0) {
              results.push('Type: SLIDER puzzle');
              results.push('The puzzle requires dragging a piece to fill a gap.');
              results.push('');

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
                  info.slider = { left: sliderRect.left, width: sliderRect.width };
                }
                const track = document.querySelector('.geetest_slider_track, .geetest_slider, [class*="slider_track"]');
                if (track) {
                  info.track = { width: track.getBoundingClientRect().width };
                }
                return info;
              });

              const puzzleEl = targetFrame.locator('.geetest_panel, .geetest_widget, [class*="geetest_container"]').first();
              const screenshotPath = join(homedir(), '.aurix-slider-puzzle.png');
              try {
                if (await puzzleEl.count() > 0) await puzzleEl.screenshot({ path: screenshotPath });
                else await p.screenshot({ path: screenshotPath });
              } catch { await p.screenshot({ path: screenshotPath }); }
              results.push(`Puzzle screenshot: ${screenshotPath}`);

              let gapOffset: number | null = null;
              if (sliderInfo.cut && sliderInfo.bg) {
                if (sliderInfo.cut.styleLeft && sliderInfo.cut.styleLeft > 0) {
                  gapOffset = Math.round(sliderInfo.cut.styleLeft);
                  results.push(`Gap position (CSS left): ${gapOffset}px from puzzle left edge`);
                } else {
                  gapOffset = Math.round(sliderInfo.cut.left - sliderInfo.bg.left);
                  results.push(`Gap position (rect): ${gapOffset}px from puzzle left edge`);
                }
              }
              if (gapOffset === null && sliderInfo.cut?.transform && sliderInfo.cut.transform !== 'none') {
                const match = sliderInfo.cut.transform.match(/matrix\(.*?,\s*([\d.]+)/);
                if (match) {
                  gapOffset = Math.round(parseFloat(match[1]));
                  results.push(`Gap position (transform): ${gapOffset}px from puzzle left edge`);
                }
              }

              if (sliderInfo.slider) results.push(`Slider handle: x=${Math.round(sliderInfo.slider.left)}, width=${Math.round(sliderInfo.slider.width)}`);
              if (sliderInfo.track) results.push(`Track width: ${Math.round(sliderInfo.track.width)}px`);

              if (gapOffset !== null) {
                const pieceHalf = Math.round((sliderInfo.piece?.width || 44) / 2);
                const adjusted = gapOffset - pieceHalf;
                results.push('');
                results.push(`[OK] RECOMMENDED: drag-to target=".geetest_slider_button" value="${adjusted},0"`);
                results.push(`(gap ${gapOffset}px - half piece ${pieceHalf}px = ${adjusted}px drag distance)`);
              } else {
                results.push('');
                results.push('[WARN] Could not auto-detect gap. Look at the puzzle screenshot, find the gap/hole, and estimate the pixel offset.');
                results.push('Then: drag-to target=".geetest_slider_button" value="<estimated_px>,0"');
              }
            } else {
              results.push('Type: IMAGE challenge');
              const gridResult = await analyzeImageChallenge(p, targetFrame, captchaType);
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
              results.push('Read the text from the screenshot and use "fill" to type it into the captcha input field.');
              const input = p.locator('input[name*="captcha"], input[id*="captcha"], input[placeholder*="captcha" i], input[placeholder*="code" i]');
              if (await input.count() > 0) {
                const name = await input.first().getAttribute('name') || await input.first().getAttribute('id') || 'captcha input';
                results.push(`Captcha input field found: ${name}`);
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
            if (url.includes('bframe') || url.includes('recaptcha')) {
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
          const tileIndex = parseInt(value || target || '0');
          const frames = p.frames();

          let challengeFrame: any = null;
          let provider = 'unknown';

          for (const frame of frames) {
            const url = frame.url();
            if (url.includes('bframe') || url.includes('recaptcha')) {
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

          const tiles = await findGridTiles(challengeFrame, provider);
          if (tiles.length === 0) return err('No grid tiles found', 'Use "captcha-grid" to scan the challenge first');
          if (tileIndex < 0 || tileIndex >= tiles.length) return err(`Tile index ${tileIndex} out of range (0-${tiles.length - 1})`);

          try {
            const tile = tiles[tileIndex];
            await tile.click({ force: true });
            await p.waitForTimeout(500 + Math.random() * 400);

            const isRecaptcha = provider === 'recaptcha';
            const selectedClass = isRecaptcha ? '.rc-imageselect-dynamic-selected' : '.task-image.selected, .task .selected';
            const selectedCount = await challengeFrame.locator(selectedClass).count();

            if (isRecaptcha) {
              await p.waitForTimeout(1500 + Math.random() * 1000);
              const newTiles = await findGridTiles(challengeFrame, provider);
              const screenshotPath = join(homedir(), `.aurix-tile-after-${tileIndex}.png`);
              await challengeFrame.locator('.rc-imageselect-table-33, .rc-imageselect-table-44, table').first().screenshot({ path: screenshotPath }).catch(() => p.screenshot({ path: screenshotPath }));
              return ok(`Clicked tile ${tileIndex}`, {
                selected: `${selectedCount} tile(s)`,
                'new tile': 'appeared — check screenshot and evaluate',
                screenshot: screenshotPath,
                next: 'Use "click-tile" for next matching tile, or "captcha-verify" when done',
              });
            }

            return ok(`Clicked tile ${tileIndex}`, {
              selected: `${selectedCount} tile(s)`,
              next: 'Continue clicking matching tiles, then use "captcha-verify"',
            });
          } catch (e: any) {
            return err(`Failed to click tile ${tileIndex}: ${e.message}`, 'Use "captcha-grid" to re-scan the challenge');
          }
        }

        case 'captcha-verify': {
          const p = await ensureBrowser();
          const frames = p.frames();

          let challengeFrame: any = null;
          let provider = 'unknown';

          for (const frame of frames) {
            const url = frame.url();
            if (url.includes('bframe') || url.includes('recaptcha')) {
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

          try {
            let verifyBtn = challengeFrame.locator('#recaptcha-verify-button, .rc-button-submit, .button-submit, [id*="verify"]');
            if (await verifyBtn.count() === 0) {
              verifyBtn = challengeFrame.locator('button:has-text("Verify"), button:has-text("Next"), button:has-text("Submit")');
            }
            if (await verifyBtn.count() === 0) {
              return err('No verify button found', 'Use "captcha-grid" to analyze the challenge first');
            }

            await verifyBtn.first().click({ force: true });
            await p.waitForTimeout(3000);

            const screenshotPath = join(homedir(), '.aurix-captcha-verify-result.png');

            const errorText = await challengeFrame.locator('.rc-imageselect-incorrect-response, .error-message, .incorrect').count();
            if (errorText > 0) {
              const errorMsg = await challengeFrame.locator('.rc-imageselect-incorrect-response, .error-message').first().textContent().catch(() => 'Incorrect answer');
              await p.screenshot({ path: screenshotPath });
              return err(`Verification failed: "${errorMsg}"`, `Challenge refreshed. Use "captcha-grid" to re-analyze, then click matching tiles again. Screenshot: ${screenshotPath}`);
            }

            const newChallenge = await challengeFrame.locator('.rc-imageselect-instructions, .prompt-text').count();
            if (newChallenge > 0) {
              const instruction = await challengeFrame.locator('.rc-imageselect-instructions, .prompt-text').first().textContent().catch(() => '');
              await p.screenshot({ path: screenshotPath });
              return warn(`New challenge appeared: "${instruction}"`, {
                screenshot: screenshotPath,
                next: 'Use "captcha-grid" to analyze and "click-tile" to solve',
              });
            }

            await p.screenshot({ path: screenshotPath });
            return ok('CAPTCHA verification submitted', {
              screenshot: screenshotPath,
              note: 'Check if the form/page progressed. If CAPTCHA reappears, use "captcha-grid" again.',
            });
          } catch (e: any) {
            return err(`Verify failed: ${e.message}`, 'Use "captcha-grid" to re-scan and retry');
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
            results.push(`[OK] RECOMMENDED OFFSET: drag-to value="${adjustedOffset},0"`);
            results.push(`(gap at ${gapOffset}px minus half piece width ${pieceHalfWidth}px = ${adjustedOffset}px)`);
          } else if (gapOffset !== null) {
            results.push('');
            results.push(`[OK] RECOMMENDED OFFSET: drag-to value="${gapOffset},0"`);
          } else {
            results.push('');
            results.push('[WARN] Could not auto-detect gap position from DOM.');
            results.push('Look at the puzzle screenshot to find where the gap/hole is.');
            results.push('Estimate the pixel distance from the LEFT edge of the puzzle to the CENTER of the gap.');
            results.push('Then use: drag-to target=".geetest_slider_button" value="<estimated_px>,0"');
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
                  await loc.fill(val, { timeout: 3000 });
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

            const needsVision = solveResults.some(r => r.includes('CAPTCHA SOLVING STEPS') || r.includes('REQUIRES_VISION'));
            if (!needsVision) {
              await p.waitForTimeout(2000);
              results.push('Verification completed. Continuing form submission...');
            } else {
              results.push('');
              results.push('⚠ CAPTCHA grid analysis is above. Follow the CAPTCHA SOLVING STEPS to complete it, then re-run signup-assist to continue.');
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
                  await loc.fill(val, { timeout: 3000 });
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

            const needsVision = solveResults.some(r => r.includes('CAPTCHA SOLVING STEPS') || r.includes('REQUIRES_VISION'));
            if (!needsVision) {
              await p.waitForTimeout(2000);
              results.push('Verification completed. Continuing login...');
            } else {
              results.push('');
              results.push('⚠ CAPTCHA grid analysis is above. Follow the CAPTCHA SOLVING STEPS to complete it, then re-run signin-assist to continue.');
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

            const startX = sourceBox.x + sourceBox.width / 2;
            const startY = sourceBox.y + sourceBox.height / 2;

            let endX: number, endY: number;

            const coords = value.split(',').map(s => parseInt(s.trim()));
            if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
              endX = startX + coords[0];
              endY = startY + coords[1];
            } else {
              const targetEl = p.locator(value).first();
              const targetBox = await targetEl.boundingBox();
              if (!targetBox) return err(`Target element "${value}" not found or not visible`);
              endX = targetBox.x + targetBox.width / 2;
              endY = targetBox.y + targetBox.height / 2;
            }

            await p.mouse.move(startX, startY);
            await p.waitForTimeout(100 + Math.random() * 150);
            await p.mouse.down();
            await p.waitForTimeout(200 + Math.random() * 200);

            const steps = 15 + Math.floor(Math.random() * 10);
            for (let i = 1; i <= steps; i++) {
              const progress = i / steps;
              const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
              const x = startX + (endX - startX) * eased + (Math.random() - 0.5) * 2;
              const y = startY + (endY - startY) * eased + (Math.random() - 0.5) * 2;
              await p.mouse.move(x, y);
              await p.waitForTimeout(10 + Math.random() * 25);
            }

            await p.mouse.move(endX, endY);
            await p.waitForTimeout(100 + Math.random() * 200);
            await p.mouse.up();
            await p.waitForTimeout(500);

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

          const duration = parseInt(value) || 3000;
          try {
            const el = p.locator(target).first();
            const box = await el.boundingBox();
            if (!box) return err(`Element "${target}" not found or not visible`);

            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;

            await p.mouse.move(x, y);
            await p.waitForTimeout(100 + Math.random() * 100);
            await p.mouse.down();

            const holdSteps = Math.floor(duration / 100);
            for (let i = 0; i < holdSteps; i++) {
              const jitterX = x + (Math.random() - 0.5) * 3;
              const jitterY = y + (Math.random() - 0.5) * 3;
              await p.mouse.move(jitterX, jitterY);
              await p.waitForTimeout(80 + Math.random() * 40);
            }

            await p.mouse.up();
            await p.waitForTimeout(500);

            const screenshotPath = join(homedir(), '.aurix-hold-result.png');
            await p.screenshot({ path: screenshotPath });

            return ok(`Held click on "${target}" for ${duration}ms`, {
              position: `(${Math.round(x)}, ${Math.round(y)})`,
              screenshot: screenshotPath,
            });
          } catch (e: any) {
            return err(`Hold-click failed: ${e.message}`, 'Check if the element exists with "snapshot"');
          }
        }

        default:
          return `Unknown action: "${action}". Available: navigate, click, fill, type, screenshot, snapshot, text, html, url, title, scroll, back, forward, press-key, select, wait, evaluate, new-tab, switch-tab, close-tab, open-tabs, cookies, upload, signup-assist, signin-assist, set-proxy, set-ui, detect-captcha, solve-captcha, captcha-grid, click-tile, captcha-verify, slider-analyze, drag-to, hold-click, close, status`;
      }
    } catch (e: any) {
      const msg = e.message || String(e);
      if (msg.includes('Timeout')) {
        return `Browser timeout: ${msg}\n\nTry: increase timeout in options, use "wait" action first, or check if the element exists with "snapshot".`;
      }
      if (msg.includes('strict mode') || msg.includes('more than one')) {
        return `Multiple elements matched "${target}". Use a more specific selector (CSS, role=, placeholder=) or add .first()/.nth(0).`;
      }
      return `Browser error: ${msg}`;
    }
  },
};
