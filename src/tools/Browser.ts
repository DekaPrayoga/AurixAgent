import { type BrowserContext, type Page } from 'playwright-core';
import { launchPersistentContext, ensureBinary } from 'cloakbrowser';
import { homedir } from 'os';
import { join } from 'path';
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import sharp from 'sharp';
import type { Tool } from './Registry.js';
import { loadConfig } from '../agent/Config.js';
import {
  visionClassify, readFileBase64, analyzeTileCrops,
  loadCaptchaTraining, saveCaptchaTraining, findGridTiles,
  humanClick, humanMove, humanHold, warmupBehavior,
  solveCaptchaGrid, autoSolveCaptcha, analyzeImageChallenge,
  _lastGridAnalyzeTime, bezierPoint, easeInOut,
} from './captcha/index.js';

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
    // cloakbrowser's default stealthArgs inject --no-sandbox, which is
    // invalid on Windows Chromium and causes silent navigation failures
    // (page stays at about:blank). We pass our own args explicitly below.
    stealthArgs: process.platform !== 'win32',
    colorScheme: 'light',
    viewport: vp,
    userAgent: ua,
    timezone: geo.timezone,
    contextOptions: {
      geolocation: { latitude: geo.latitude, longitude: geo.longitude },
      permissions: ['geolocation'],
    },
    args: (() => {
      const base = [
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
      ];
      if (process.platform === 'win32') {
        return base.filter(a => !a.startsWith('--no-sandbox') && !a.startsWith('--disable-setuid-sandbox'));
      }
      return base;
    })(),
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

          if (p.url() === 'about:blank') {
            try {
              await p.goto(fullUrl, { waitUntil: 'load', timeout: timeout * 2 });
            } catch {}
          }
          if (p.url() === 'about:blank') {
            try {
              await p.goto(fullUrl, { waitUntil: 'networkidle', timeout: timeout * 3 });
            } catch {}
          }
          if (p.url() === 'about:blank') {
            const activeProxy = browserProxy || pickRandomProxy();
            const hints = [
              `Proxy: ${activeProxy || 'none'}`,
              `Target: ${fullUrl}`,
              `Platform: ${process.platform}`,
            ];
            if (process.platform === 'win32') {
              hints.push('Hint: run "npm rebuild cloakbrowser" to re-download the Chromium binary');
            }
            return err(`Navigation failed — page stayed at about:blank after 3 attempts`,
              `Possible causes:\n  1. cloakbrowser binary not installed (run: npm rebuild cloakbrowser)\n  2. Proxy unreachable (${activeProxy || 'none'})\n  3. URL unreachable (${fullUrl})\n  4. ${process.platform === 'win32' ? 'cloakbrowser Chromium binary mismatch on Windows' : 'Network or DNS issue'}`);
          }

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

          const _solveTimeout = 120_000;
          const _solveLogic = async () => {

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
              if (recaptchaBframe) {
                results.push('Image challenge already visible. Auto-solving...');
                const maxRetries = 5;
                let solved = false;
                for (let attempt = 0; attempt < maxRetries; attempt++) {
                  if (attempt > 0) results.push(`\nRetry attempt ${attempt}/${maxRetries - 1}...`);
                  const solveResult = await solveCaptchaGrid(p, recaptchaBframe, 'recaptcha');
                  results.push(solveResult);
                  if (solveResult.includes('CAPTCHA SOLVED')) { solved = true; break; }
                  if (solveResult.includes('Falling back to manual mode')) break;
                  await p.waitForTimeout(2000);
                  const refreshedFrames = p.frames();
                  const newChallenge = refreshedFrames.find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
                  if (!newChallenge) { results.push('Challenge frame disappeared, captcha may be solved'); solved = true; break; }
                  recaptchaBframe = newChallenge;
                }
                if (!solved && !results.some(r => r.includes('Falling back'))) {
                  results.push(`\nAuto-solve exhausted after ${maxRetries} attempts. Use "captcha-grid" and "click-tile" for manual solving.`);
                }
              } else {
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
                const checkbox = checkboxFrame.locator('#recaptcha-anchor, .recaptcha-checkbox, .rc-anchor-checkbox, .recaptcha-checkbox-border, .recaptcha-checkbox-checkmark, [id="recaptcha-anchor"]');
                if (await checkbox.count() > 0) {
                  await p.waitForTimeout(1000 + Math.random() * 1500);
                  await humanClick(checkbox, p);
                  await p.waitForTimeout(3000);

                  const updatedFrames = p.frames();
                  let challengeFrame = updatedFrames.find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
                  if (challengeFrame) {
                    results.push('Image challenge appeared. Auto-solving...');
                    const maxRetries = 5;
                    let solved = false;
                    for (let attempt = 0; attempt < maxRetries; attempt++) {
                      if (attempt > 0) results.push(`\nRetry attempt ${attempt}/${maxRetries - 1}...`);
                      const solveResult = await solveCaptchaGrid(p, challengeFrame, 'recaptcha');
                      results.push(solveResult);

                      if (solveResult.includes('CAPTCHA SOLVED')) {
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
                      challengeFrame = newChallenge;
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
                  results.push(warn('reCAPTCHA anchor frame found but checkbox element missing', { action: 'clicking anchor body to trigger challenge' }));
                  const anchor = checkboxFrame.locator('#recaptcha-anchor, .recaptcha-checkbox-area, [role="presentation"], .recaptcha-checkbox-border, body').first();
                  await humanClick(anchor, p).catch(() => {});
                  await p.waitForTimeout(4000);

                  let retryFrames = p.frames();
                  let challengeFrame = retryFrames.find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
                  if (!challengeFrame) {
                    await anchor.click({ force: true }).catch(() => {});
                    await p.waitForTimeout(3000);
                    retryFrames = p.frames();
                    challengeFrame = retryFrames.find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
                  }
                  if (challengeFrame) {
                    results.push('Image challenge appeared after clicking anchor. Auto-solving...');
                    const maxRetries = 5;
                    let solved = false;
                    for (let attempt = 0; attempt < maxRetries; attempt++) {
                      if (attempt > 0) results.push(`\nRetry attempt ${attempt}/${maxRetries - 1}...`);
                      const solveResult = await solveCaptchaGrid(p, challengeFrame, 'recaptcha');
                      results.push(solveResult);
                      if (solveResult.includes('CAPTCHA SOLVED')) { solved = true; break; }
                      if (solveResult.includes('Falling back to manual mode')) break;
                      await p.waitForTimeout(2000);
                      const refreshedFrames = p.frames();
                      const newChallenge = refreshedFrames.find(f => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
                      if (!newChallenge) { results.push('Challenge frame disappeared, captcha may be solved'); solved = true; break; }
                      challengeFrame = newChallenge;
                    }
                    if (!solved && !results.some(r => r.includes('Falling back'))) {
                      results.push(`\nAuto-solve exhausted after ${maxRetries} attempts. Use "captcha-grid" and "click-tile" for manual solving.`);
                    }
                  } else {
                    results.push('No challenge appeared after clicking anchor. Use "captcha-grid" to check state.');
                  }
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
              } // close else (no bframe)
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
                  let challengeFrame = updatedFrames.find((f: any) => f.url().includes('hcaptcha') && f.url().includes('challenge'));
                  if (challengeFrame) {
                    results.push('Image challenge appeared. Auto-solving...');
                    const maxRetries = 5;
                    let solved = false;
                    for (let attempt = 0; attempt < maxRetries; attempt++) {
                      if (attempt > 0) results.push(`\nRetry attempt ${attempt}/${maxRetries - 1}...`);
                      const solveResult = await solveCaptchaGrid(p, challengeFrame, 'hcaptcha');
                      results.push(solveResult);

                      if (solveResult.includes('CAPTCHA SOLVED')) {
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
                      challengeFrame = newChallenge;
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
          };

          try {
            return await Promise.race([
              _solveLogic(),
              new Promise<string>((_, rej) => setTimeout(() => rej(new Error('solve-captcha timed out (120s)')), _solveTimeout)),
            ]);
          } catch (e: any) {
            results.push(`\n[TIMEOUT] ${e.message}`);
            results.push('Auto-solve did not complete. Use "captcha-grid" and "click-tile" for manual solving.');
            return results.join('\n');
          }
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
              if (tileIndex >= initialTiles.length) {
                results.push(`  Tile ${tileIndex}: out of range (${initialTiles.length} tiles), skipping`);
                continue;
              }

              const tile = initialTiles[tileIndex];
              const selectedBefore = await challengeFrame.locator(selectedClass).count().catch(() => 0);
              try {
                await challengeFrame.evaluate((idx: number) => {
                  const tds = document.querySelectorAll('table td');
                  if (tds[idx]) (tds[idx] as HTMLElement).click();
                }, tileIndex);
              } catch {
                await tile.click({ force: true, timeout: 3000 });
              }
              await p.waitForTimeout(300 + Math.random() * 300);

              const selectedCount = await challengeFrame.locator(selectedClass).count().catch(() => 0);
              const clickStatus = selectedCount !== selectedBefore
                ? `selected (${selectedBefore} → ${selectedCount})`
                : `unchanged (${selectedCount})`;
              results.push(`  Tile ${tileIndex}: ${clickStatus}`);

              if (isRecaptcha) {
                await p.waitForTimeout(1500 + Math.random() * 500);
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

            try {
              await challengeFrame.evaluate(() => {
                const btn = document.querySelector('#recaptcha-verify-button, .rc-button-submit, .button-submit, [id*="verify"]') as HTMLElement;
                if (btn) btn.click();
              });
            } catch {
              await humanClick(verifyBtn, p);
            }
            await p.waitForTimeout(3000);

            const screenshotPath = join(homedir(), '.aurix-captcha-verify-result.png');

            const errorEl2 = challengeFrame.locator('.rc-imageselect-incorrect-response, .error-message, .incorrect').first();
            const errorVisible2 = await errorEl2.count() > 0 && await errorEl2.isVisible().catch(() => false);
            if (errorVisible2) {
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

                if (solveResult.includes('CAPTCHA SOLVED')) {
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
                if (solveResult.includes('CAPTCHA SOLVED')) return results.join('\n');
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

          const cookieSelectors = [
            'button:has-text("Accept All")', 'button:has-text("Accept all")', 'button:has-text("accept all")',
            'button:has-text("Accept")', 'button:has-text("Accept Cookies")',
            'button:has-text("I agree")', 'button:has-text("Got it")', 'button:has-text("OK")',
            'button:has-text("Allow All")', 'button:has-text("Allow all")',
            '[id*="cookie"] button', '[class*="cookie"] button',
            '[id*="consent"] button', '[class*="consent"] button',
            '.cc-accept', '.cookie-accept', '#accept-cookies',
          ];
          for (const sel of cookieSelectors) {
            try {
              const btn = p.locator(sel).first();
              if (await btn.count() > 0 && await btn.isVisible()) {
                await btn.click({ timeout: 2000 });
                results.push(`  ✓ Dismissed cookie banner: ${sel}`);
                await p.waitForTimeout(500);
                break;
              }
            } catch {}
          }

          const allFrames = [p, ...p.frames().filter(f => f !== p.mainFrame())];
          let activeFrame: any = p;

          for (const frame of allFrames) {
            const inputs = await frame.locator('input:visible, select:visible, textarea:visible').count();
            if (inputs > 0) { activeFrame = frame; break; }
          }

          const hasEmailField = await activeFrame.locator('input[type="email"]:visible, input[name*="email" i]:visible, input[autocomplete="email"]:visible').count() > 0;
          const hasPasswordField = await activeFrame.locator('input[type="password"]:visible').count() > 0;

          if (!hasEmailField && !hasPasswordField) {
            const ctaSelectors = [
              'button:has-text("Sign Up With Email")', 'button:has-text("sign up with email")',
              'a:has-text("Sign Up With Email")', 'a:has-text("sign up with email")',
              'button:has-text("Sign up with email")',
              'button:has-text("Create Account")', 'button:has-text("create account")',
              'button:has-text("Sign Up")', 'button:has-text("sign up")',
              'button:has-text("Register")', 'button:has-text("register")',
              'button:has-text("Get Started")', 'button:has-text("get started")',
              'button:has-text("Continue with Email")', 'button:has-text("continue with email")',
              'button:has-text("Use Email")', 'button:has-text("use email")',
              'a:has-text("Sign Up")', 'a:has-text("Register")',
              '[data-testid*="signup"]', '[data-testid*="email"]',
            ];
            for (const sel of ctaSelectors) {
              try {
                const btn = activeFrame.locator(sel).first();
                if (await btn.count() > 0 && await btn.isVisible()) {
                  await btn.click({ timeout: 3000 });
                  results.push(`  ✓ Clicked CTA: ${sel}`);
                  await p.waitForTimeout(1500);
                  break;
                }
              } catch {}
            }

            for (const frame of [p, ...p.frames().filter(f => f !== p.mainFrame())]) {
              const inputs = await frame.locator('input:visible, select:visible, textarea:visible').count();
              if (inputs > 0) { activeFrame = frame; break; }
            }
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
                    await loc.fill(val, { timeout: 1500 });
                  } catch {
                    await loc.click({ timeout: 1500 });
                    await loc.pressSequentially(val, { delay: 30, timeout: 5000 });
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
                  await loc.click({ timeout: 1500 });
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
              'input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]',
              'input[autocomplete="email"]', 'input[placeholder*="email" i]',
            ], data.email, 'Email');
          }

          if (data.password) {
            await fillField([
              'input[type="password"]', 'input[name*="password" i]', 'input[id*="password" i]',
              'input[autocomplete="new-password"]',
            ], data.password, 'Password');
          }

          if (data.firstName) {
            await fillField([
              'input[name*="first" i]', 'input[id*="first" i]',
              'input[autocomplete="given-name"]', 'input[placeholder*="first" i]',
            ], data.firstName, 'First name');
          }

          if (data.lastName) {
            await fillField([
              'input[name*="last" i]', 'input[id*="last" i]',
              'input[autocomplete="family-name"]', 'input[placeholder*="last" i]',
            ], data.lastName, 'Last name');
          }

          if (data.firstName && !data.lastName) {
            await fillField([
              'input[name*="name" i]', 'input[id*="name" i]', 'input[autocomplete="name"]',
            ], data.firstName + ' User', 'Full name');
          }

          if (data.phone) {
            await fillField([
              'input[type="tel"]', 'input[name*="phone" i]', 'input[autocomplete="tel"]',
            ], data.phone, 'Phone');
          }

          if (data.birthYear || data.birthMonth || data.birthDay) {
            const birthYear = data.birthYear || '2003';
            const birthMonth = data.birthMonth || 'January';
            const birthDay = data.birthDay || '15';
            await selectDropdown([
              'select[id*="year" i]', 'select[name*="year" i]',
            ], birthYear, 'Birth year');
            await selectDropdown([
              'select[id*="month" i]', 'select[name*="month" i]',
            ], birthMonth, 'Birth month');
            await selectDropdown([
              'select[id*="day" i]', 'select[name*="day" i]',
            ], birthDay, 'Birth day');
          }

          if (data.country) {
            await selectDropdown([
              'select[name*="country" i]', 'select[id*="country" i]',
            ], data.country, 'Country');
          }

          if (data.username) {
            await fillField([
              'input[name*="username" i]', 'input[id*="username" i]',
            ], data.username, 'Username');
          }

          await clickField([
            'input[type="checkbox"][name*="agree" i]',
            'input[type="checkbox"][name*="terms" i]',
            'input[type="checkbox"][name*="consent" i]',
            'input[type="checkbox"][id*="agree" i]',
            'input[type="checkbox"][id*="terms" i]',
            'label:has-text("agree") input[type="checkbox"]',
            'label:has-text("terms") input[type="checkbox"]',
            'label:has-text("accept") input[type="checkbox"]',
            'label:has-text("I agree") input[type="checkbox"]',
            '[role="checkbox"][aria-checked="false"]',
          ], 'Terms/Agreement checkbox');

          await p.waitForTimeout(500);

          let clicked = await clickField([
            'button[type="submit"]', 'input[type="submit"]',
            '[data-testid*="signup"]', '[data-testid*="submit"]',
            'button:has-text("Sign Up With Email")', 'button:has-text("Sign up")',
            'button:has-text("Sign Up")', 'button:has-text("sign up")',
            'button:has-text("Create Account")', 'button:has-text("create account")',
            'button:has-text("Register")', 'button:has-text("register")',
            'button:has-text("Next")', 'button:has-text("Continue")',
            'button:has-text("Submit")', 'button:has-text("Create")',
            '#signup-button', '#submit-btn',
          ], 'Submit/Next button');

          if (!clicked) {
            const submitBtn = activeFrame.locator('button').filter({ hasText: /sign\s*up|register|submit|create|continue|next/i }).first();
            if (await submitBtn.count() > 0 && await submitBtn.isVisible()) {
              try {
                await submitBtn.click({ timeout: 3000 });
                results.push('  ✓ Submit button: clicked (regex match)');
                clicked = true;
              } catch {}
            }
          }

          if (!clicked) {
            try {
              const btnClicked = await activeFrame.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
                for (const btn of btns) {
                  const text = (btn as HTMLElement).innerText?.toLowerCase() || (btn as HTMLInputElement).value?.toLowerCase() || '';
                  const rect = btn.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0 && /sign\s*up|register|submit|create|continue|next/.test(text)) {
                    (btn as HTMLElement).click();
                    return text;
                  }
                }
                return '';
              });
              if (btnClicked) {
                results.push(`  ✓ Submit button: clicked via evaluate ("${btnClicked}")`);
                clicked = true;
              }
            } catch {}
          }

          if (clicked) {
            results.push('  Form submitted successfully.');
          } else {
            results.push('  ⚠ Could not find submit button. Take a screenshot and try clicking it manually.');
          }

          await p.waitForTimeout(2000);

          const postCaptcha = p.frames().some(f => {
            const u = f.url();
            return u.includes('/recaptcha/') && u.includes('/bframe') ||
              u.includes('hcaptcha') && u.includes('challenge') ||
              u.includes('funcaptcha') || u.includes('arkoselabs');
          });
          const hasCaptchaWidget = p.frames().some(f => {
            const u = f.url();
            return u.includes('recaptcha') || u.includes('hcaptcha') || u.includes('funcaptcha') ||
              u.includes('arkoselabs') || u.includes('geetest') || u.includes('turnstile') ||
              u.includes('mtcaptcha');
          });

          if (postCaptcha) {
            results.push('');
            results.push('⚠ CAPTCHA CHALLENGE APPEARED after submission.');
            results.push('→ Use action "solve-captcha" NOW to solve it automatically.');
            results.push('→ After solving, check if the form was submitted successfully.');
          } else if (hasCaptchaWidget) {
            results.push('');
            results.push('⚠ CAPTCHA widget present on page.');
            results.push('→ Use action "solve-captcha" to complete verification, then re-click submit if needed.');
          }

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

          const cookieSelectors = [
            'button:has-text("Accept All")', 'button:has-text("Accept all")', 'button:has-text("accept all")',
            'button:has-text("Accept")', 'button:has-text("Accept Cookies")',
            'button:has-text("I agree")', 'button:has-text("Got it")', 'button:has-text("OK")',
            'button:has-text("Allow All")', 'button:has-text("Allow all")',
            '[id*="cookie"] button', '[class*="cookie"] button',
            '[id*="consent"] button', '[class*="consent"] button',
            '.cc-accept', '.cookie-accept', '#accept-cookies',
          ];
          for (const sel of cookieSelectors) {
            try {
              const btn = p.locator(sel).first();
              if (await btn.count() > 0 && await btn.isVisible()) {
                await btn.click({ timeout: 2000 });
                results.push(`  ✓ Dismissed cookie banner: ${sel}`);
                await p.waitForTimeout(500);
                break;
              }
            } catch {}
          }

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
                    await loc.fill(val, { timeout: 1500 });
                  } catch {
                    await loc.click({ timeout: 1500 });
                    await loc.pressSequentially(val, { delay: 30, timeout: 5000 });
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
                  await loc.click({ timeout: 1500 });
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
            let solveResults: string[];
            try {
              solveResults = await Promise.race([
                autoSolveCaptcha(p),
                new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error('auto-solve timed out (30s)')), 30000)),
              ]);
            } catch (e: any) {
              solveResults = [`Auto-solve: ${e.message}`];
            }
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
