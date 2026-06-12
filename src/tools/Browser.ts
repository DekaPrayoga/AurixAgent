import { type BrowserContext, type Page, firefox, chromium } from 'playwright';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { Tool } from './Registry.js';

let context: BrowserContext | null = null;
let page: Page | null = null;

const PROFILE_DIR = join(homedir(), '.aurix-browser-profile');

function detectBrowser(): 'firefox' | 'chromium' {
  if (existsSync('/usr/bin/firefox') || existsSync('/snap/bin/firefox')) return 'firefox';
  return 'chromium';
}

async function ensureBrowser(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  const browserType = detectBrowser();

  context = await (browserType === 'firefox'
    ? firefox.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        viewport: { width: 1280, height: 720 },
        args: ['-width=1280', '-height=720'],
      })
    : chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        viewport: { width: 1280, height: 720 },
        args: ['--no-sandbox'],
      }));

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
  return `[Browser: ${detectBrowser()}] Profile: ${PROFILE_DIR}\nURL: ${page.url()}\nTitle: ${page.title()}`;
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

export const browserTool: Tool = {
  name: 'browser',
  description: `Control a real browser (Firefox/Chromium) with persistent profile — cookies, sessions, and logged-in accounts survive across runs. Use this for web automation, form filling, account registration, reading emails in Gmail, scraping authenticated pages, and any task requiring a real browser session.

Actions: navigate, click, fill, type, screenshot, snapshot, text, url, title, scroll, back, forward, press-key, select, wait, evaluate, new-tab, switch-tab, close-tab, status, close.

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
            return `Browser: not running. Use action "navigate" to start it.\nProfile: ${PROFILE_DIR}\nEngine: ${detectBrowser()}`;
          }
          const title = await page.title();
          return `Browser: running\nEngine: ${detectBrowser()}\nProfile: ${PROFILE_DIR}\nURL: ${page.url()}\nTitle: ${title}\nOpen tabs: ${context!.pages().length}`;
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
            ? bodyText.slice(0, 10000) + `\n\n... [${bodyText.length - 10000} more chars — use target to get specific element text]`
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
            ? html.slice(0, 15000) + `\n\n... [${html.length - 15000} more chars — use target for specific elements]`
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

        default:
          return `Unknown action: "${action}". Available: navigate, click, fill, type, screenshot, snapshot, text, html, url, title, scroll, back, forward, press-key, select, wait, evaluate, new-tab, switch-tab, close-tab, cookies, upload, close, status`;
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
