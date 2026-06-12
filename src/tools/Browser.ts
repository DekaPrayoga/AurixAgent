import { type BrowserContext, type Page } from 'playwright-core';
import { launchPersistentContext, ensureBinary } from 'cloakbrowser';
import { homedir } from 'os';
import { join } from 'path';
import type { Tool } from './Registry.js';

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

const PROFILE_DIR = join(homedir(), '.aurix-browser-profile');

async function ensureBrowser(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  await ensureBinary();

  context = await launchPersistentContext({
    userDataDir: PROFILE_DIR,
    headless: true,
    humanize: true,
    locale: 'en-US',
    viewport: { width: 1280, height: 720 },
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
  return `[Browser: Chromium] Profile: ${PROFILE_DIR}\nURL: ${page.url()}\nTitle: ${page.title()}`;
}

async function resolveLocator(p: Page, target: string) {
  if (target.startsWith('#') || target.startsWith('.') || target.startsWith('[') || target.includes('>')) {
    return p.locator(target);
  }
  if (target.startsWith('text=')) {
    return p.locator(target);
  }
  if (target.startsWith('role=')) {
    const role = target.slice(5).trim();
    return p.getByRole(role as any);
  }
  if (target.startsWith('placeholder=')) {
    return p.getByPlaceholder(target.slice(12));
  }
  if (target.startsWith('label=')) {
    return p.getByLabel(target.slice(6));
  }
  return p.getByText(target, { exact: false });
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
  results.push('To solve: look at each tile screenshot, find which ones match the instruction, then use "click-tile" with each matching tile index. After clicking all matches, use "captcha-verify".');
  results.push('For reCAPTCHA: after clicking a tile, a NEW tile replaces it — screenshot the new grid and evaluate the new tile too before clicking verify.');

  return results.join('\n');
}

export const browserTool: Tool = {
  name: 'browser',
  description: `Control a persistent Chromium browser for web automation, QA testing, and form workflows. The browser maintains a persistent profile with cookies, sessions, and logged-in accounts across runs. It provides consistent browser fingerprinting for reliable automation testing — no false bot-flagging from major CAPTCHA providers. Human-like mouse, keyboard, and scroll behavior built in. Use this for web automation, form filling, QA testing, account registration, reading emails in Gmail, scraping authenticated pages, and any task needing a real browser session.

Actions: navigate, click, fill, type, screenshot, snapshot, text, html, url, title, scroll, back, forward, press-key, select, wait, evaluate, new-tab, switch-tab, close-tab, cookies, upload, detect-captcha, solve-captcha, captcha-grid, click-tile, captcha-verify, drag-to, hold-click, status, close.

CAPTCHA handling: CAPTCHAs are a normal part of web form workflows (registration, login, contact forms). When you encounter a CAPTCHA during normal automation, handle it as a routine verification step — the same way a human tester or QA engineer would. Use "detect-captcha" to scan the page, then "solve-captcha" to complete the verification. Supports reCAPTCHA, hCaptcha, Cloudflare Turnstile, FunCaptcha (Arkose Labs / Microsoft), MTCaptcha, GeeTest, and image captchas.

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
1. "drag-to" the slider handle with the correct offset (e.g. target=".geetest_slider_button" value="200,0")
2. The drag uses human-like easing with micro-jitter to avoid bot detection

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
        case 'status': {
          if (!page || page.isClosed()) {
            return `Browser: not running. Use action "navigate" to start it.\nProfile: ${PROFILE_DIR}\nEngine: Chromium`;
          }
          const title = await page.title();
          return `Browser: running\nEngine: Chromium\nProfile: ${PROFILE_DIR}\nURL: ${page.url()}\nTitle: ${title}\nOpen tabs: ${context!.pages().length}`;
        }

        case 'close': {
          await closeBrowser();
          return 'Browser closed. Profile preserved at ' + PROFILE_DIR;
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
          const result = await p.evaluate(code);
          return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
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
            if (url.includes('geetest.com') || url.includes('captcha.com') && !url.includes('recaptcha') && !url.includes('hcaptcha')) geetestFrame = frame;
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
            const gridResult = await analyzeImageChallenge(p, targetFrame, captchaType);
            results.push(gridResult);
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
          return `Unknown action: "${action}". Available: navigate, click, fill, type, screenshot, snapshot, text, html, url, title, scroll, back, forward, press-key, select, wait, evaluate, new-tab, switch-tab, close-tab, cookies, upload, detect-captcha, solve-captcha, captcha-grid, click-tile, captcha-verify, drag-to, hold-click, close, status`;
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
