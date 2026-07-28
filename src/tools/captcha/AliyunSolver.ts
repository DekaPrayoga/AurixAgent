import type { Page } from 'playwright-core';
import { visionClassify } from './common.js';

export type AliyunCaptchaType = 'TRACELESS' | 'SLIDE' | 'PUZZLE' | 'INPAINTING' | 'ONE_CLICK';

export type AliyunPoint = { x: number; y: number };

const A = 0.00355;
const B = 0.0769;
const C = -0.004;

export function invertAliyunDragDistance(pieceOffset: number): number {
  const discriminant = B * B - 4 * A * (C - Math.max(0, pieceOffset));
  return (-B + Math.sqrt(Math.max(0, discriminant))) / (2 * A);
}

export function aliyunPieceOffset(handleDistance: number): number {
  return A * handleDistance * handleDistance + B * handleDistance + C;
}

export function buildAliyunDragTrajectory(
  start: AliyunPoint,
  distance: number,
  random: () => number = Math.random
): AliyunPoint[] {
  const points: AliyunPoint[] = [];
  const overshoot = distance + 6 + random() * 5;
  for (let step = 1; step <= 42; step++) {
    const t = step / 42;
    const ease = 1 - Math.pow(1 - t, 3);
    points.push({
      x: start.x + overshoot * ease,
      y: start.y + Math.sin(t * 5) * 1.2,
    });
  }
  for (let step = 1; step <= 10; step++) {
    const t = step / 10;
    points.push({
      x: start.x + overshoot + (distance - overshoot) * t,
      y: start.y + (random() - 0.5) * 1.2,
    });
  }
  points.push({ x: start.x + distance, y: start.y });
  return points;
}

export async function detectAliyunCaptcha(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => Boolean(
      document.querySelector(
        'script[src*="aliyunCaptcha"], [id^="aliyunCaptcha"], [class*="aliyunCaptcha"], [class*="aliyun-captcha"]'
      ) || (window as any).initAliyunCaptcha
    ));
  } catch {
    return false;
  }
}

export async function classifyAliyunCaptcha(page: Page): Promise<AliyunCaptchaType> {
  return page.evaluate(() => {
    const captured = String((window as any).__aurixAliyunCaptchaType || '').toUpperCase();
    if (['TRACELESS', 'SLIDE', 'PUZZLE', 'INPAINTING', 'ONE_CLICK'].includes(captured)) {
      return captured as AliyunCaptchaType;
    }
    const visible = (selector: string) => {
      const element = document.querySelector(selector) as HTMLElement | null;
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const slider = visible('#aliyunCaptcha-sliding-slider, [id*="aliyunCaptcha"][class*="slider"], [class*="aliyunCaptcha"][class*="slider"]');
    const puzzle = visible('#aliyunCaptcha-img, #aliyunCaptcha-puzzle, #aliyunCaptcha-window-puzzle, [class*="aliyunCaptcha"][class*="puzzle"]');
    if (slider && puzzle) return 'PUZZLE';
    if (slider) return 'SLIDE';
    if (visible('#aliyunCaptcha-btn, #aliyunCaptcha-button, [class*="aliyunCaptcha"][class*="checkbox"]')) return 'ONE_CLICK';
    return 'TRACELESS';
  });
}

type AliyunGeometry = {
  handle: { x: number; y: number; width: number; height: number };
  trackWidth: number;
  background?: { x: number; y: number; width: number; height: number };
  piece?: { x: number; y: number; width: number; height: number };
  gapOffset?: number;
};

async function readGeometry(page: Page): Promise<AliyunGeometry | null> {
  return page.evaluate(() => {
    const rectOf = (element: Element | null) => {
      if (!element) return undefined;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return undefined;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const handle = rectOf(document.querySelector(
      '#aliyunCaptcha-sliding-slider, [id*="aliyunCaptcha"][class*="slider"], [class*="aliyunCaptcha"][class*="slider"]'
    ));
    if (!handle) return null;
    const track = rectOf(document.querySelector(
      '#aliyunCaptcha-sliding-track, [id*="aliyunCaptcha"][class*="track"], [class*="aliyunCaptcha"][class*="track"]'
    ));
    const background = rectOf(document.querySelector(
      '#aliyunCaptcha-img, #aliyunCaptcha-window-puzzle, [class*="aliyunCaptcha"][class*="puzzle-bg"]'
    ));
    const pieceElement = document.querySelector(
      '#aliyunCaptcha-puzzle, [class*="aliyunCaptcha"][class*="puzzle-piece"]'
    ) as HTMLElement | null;
    const piece = rectOf(pieceElement);
    let gapOffset: number | undefined;
    const gap = document.querySelector('[class*="aliyunCaptcha"][class*="gap"], [id*="aliyunCaptcha"][id*="gap"]') as HTMLElement | null;
    const gapRect = rectOf(gap);
    if (gapRect && background) gapOffset = gapRect.x - background.x;
    if (gapOffset === undefined && pieceElement) {
      const explicit = Number.parseFloat(pieceElement.dataset.gapX || pieceElement.style.left || '');
      if (Number.isFinite(explicit) && explicit > 0) gapOffset = explicit;
    }
    return {
      handle,
      trackWidth: track ? Math.max(0, track.width - handle.width) : Math.max(0, (background?.width || 300) - handle.width),
      background,
      piece,
      gapOffset,
    };
  });
}

async function estimateGapWithVision(page: Page, geometry: AliyunGeometry, deadline: number): Promise<number | undefined> {
  if (!geometry.background) return undefined;
  const clip = geometry.background;
  const screenshot = await page.screenshot({ clip });
  const remaining = deadline - Date.now();
  if (remaining < 1000) return undefined;
  const response = await Promise.race([
    visionClassify(
      screenshot.toString('base64'),
      `This is an Aliyun slide-puzzle background rendered at ${Math.round(clip.width)} pixels wide. Estimate the x coordinate in pixels from the left edge to the LEFT EDGE of the missing puzzle-shaped gap. Reply with only one integer.`
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve(''), remaining)),
  ]);
  const value = Number.parseInt(response.replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(value) || value < 10 || value > clip.width - 10) return undefined;
  return value;
}

async function dragAliyun(page: Page, geometry: AliyunGeometry, distance: number, deadline: number): Promise<void> {
  const maximum = Math.max(1, geometry.trackWidth);
  const clamped = Math.max(1, Math.min(distance, maximum));
  const start = {
    x: geometry.handle.x + geometry.handle.width / 2,
    y: geometry.handle.y + geometry.handle.height / 2,
  };
  await page.mouse.move(start.x, start.y, { steps: 8 });
  await page.mouse.down();
  const points = buildAliyunDragTrajectory(start, clamped);
  for (let index = 0; index < points.length; index++) {
    if (Date.now() >= deadline) {
      await page.mouse.up().catch(() => {});
      throw new Error('Aliyun solve deadline exhausted during drag');
    }
    await page.mouse.move(points[index].x, points[index].y);
    await page.waitForTimeout(index < 42 ? 11 + (index % 4) * 4 : 20 + Math.random() * 15);
  }
  await page.waitForTimeout(160 + Math.random() * 100);
  await page.mouse.up();
}

async function hasAliyunSuccess(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as any).__aurixAliyunVerified === true).catch(() => false);
}

async function clearAliyunAttemptState(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__aurixAliyunVerified = false;
  }).catch(() => {});
}

async function openAliyunChallenge(page: Page): Promise<void> {
  const opened = await page.evaluate(() => {
    const options = (window as any).__aurixAliyunOptions || {};
    const button = typeof options.button === 'string'
      ? document.querySelector(options.button)
      : options.button;
    if (button instanceof HTMLElement) {
      button.click();
      return true;
    }
    return false;
  });
  if (opened) await page.waitForTimeout(900);
}

async function refreshAliyun(page: Page): Promise<boolean> {
  const refresh = page.locator(
    '#aliyunCaptcha-refresh, [id*="aliyunCaptcha"][class*="refresh"], [class*="aliyunCaptcha"][class*="refresh"]'
  ).first();
  if ((await refresh.count().catch(() => 0)) > 0) {
    await refresh.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return true;
  }
  await openAliyunChallenge(page);
  return false;
}

export async function solveAliyunCaptcha(
  page: Page,
  options: { maxAttempts?: number; deadlineMs?: number } = {}
): Promise<string> {
  const maxAttempts = Math.max(1, Math.min(1, options.maxAttempts ?? 1));
  const deadline = options.deadlineMs ?? Date.now() + 75_000;
  const results: string[] = ['Attempting Aliyun Captcha 2.0 natively...'];
  let completedAttempts = 0;

  for (let attempt = 0; attempt < maxAttempts && Date.now() < deadline; attempt++) {
    completedAttempts++;
    await clearAliyunAttemptState(page);
    let type = await classifyAliyunCaptcha(page);
    if (type === 'TRACELESS') {
      await openAliyunChallenge(page);
      type = await classifyAliyunCaptcha(page);
    }
    results.push(`Attempt ${attempt + 1}/${maxAttempts}: ${type}`);
    if (type === 'TRACELESS') {
      await page.evaluate(() => {
        const instance = (window as any).__aurixAliyunInstance;
        if (typeof instance?.startTracelessVerification === 'function') instance.startTracelessVerification();
      });
    } else if (type === 'ONE_CLICK') {
      const target = page.locator(
        '#aliyunCaptcha-btn, #aliyunCaptcha-button, [class*="aliyunCaptcha"][class*="checkbox"]'
      ).first();
      if ((await target.count().catch(() => 0)) > 0) await target.click({ timeout: 3000 }).catch(() => {});
    } else {
      const geometry = await readGeometry(page);
      if (!geometry) {
        results.push('[WARN] Aliyun slider handle is not visible');
        if (attempt < maxAttempts - 1) await refreshAliyun(page);
        continue;
      }
      let distance: number;
      if (type === 'SLIDE') {
        distance = geometry.trackWidth;
      } else {
        const gapOffset = geometry.gapOffset ?? await estimateGapWithVision(page, geometry, deadline);
        if (gapOffset === undefined) {
          results.push('[WARN] Aliyun puzzle gap could not be localized');
          if (attempt < maxAttempts - 1) await refreshAliyun(page);
          continue;
        }
        distance = invertAliyunDragDistance(Math.max(1, gapOffset));
        results.push(`Gap localized at ${Math.round(gapOffset)}px; quadratic handle distance ${distance.toFixed(1)}px`);
      }
      await dragAliyun(page, geometry, distance, deadline);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(1800, remaining));
    if (await hasAliyunSuccess(page)) {
      return [...results, '[OK] Aliyun Captcha 2.0 verified natively; callback token retained in page session'].join('\n');
    }
    if (attempt < maxAttempts - 1) await refreshAliyun(page);
  }

  const reason = Date.now() >= deadline
    ? `deadline exhausted after ${completedAttempts} attempt(s)`
    : `not confirmed after ${completedAttempts} native attempt(s)`;
  return [...results, `[ERROR] Aliyun Captcha 2.0 ${reason}`].join('\n');
}
