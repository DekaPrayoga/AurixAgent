import type { Page } from 'playwright-core';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { visionClassify } from './common.js';
import { detectAliyunGapOpenCv, scaleAliyunGapCoordinate } from './AliyunOpenCvDetector.js';

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
  for (let step = 1; step <= 4; step++) {
    const t = step / 4;
    const ease = 1 - Math.pow(1 - t, 3);
    points.push({
      x: start.x + overshoot * ease,
      y: start.y + Math.sin(t * 5) * 1.2,
    });
  }
  for (let step = 1; step <= 2; step++) {
    const t = step / 2;
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

async function estimateGapWithOpenCv(
  page: Page,
  geometry: AliyunGeometry,
  deadline: number
): Promise<{ gapX: number; confidence: number; method: string } | undefined> {
  const remainingBeforeCapture = deadline - Date.now();
  if (remainingBeforeCapture < 500) return undefined;
  const background = page.locator(
    '#aliyunCaptcha-img, #aliyunCaptcha-window-puzzle, [class*="aliyunCaptcha"][class*="puzzle-bg"]'
  ).first();
  const piece = page.locator(
    '#aliyunCaptcha-puzzle, [class*="aliyunCaptcha"][class*="puzzle-piece"]'
  ).first();
  if ((await background.count().catch(() => 0)) === 0 || (await piece.count().catch(() => 0)) === 0) return undefined;
  const directory = join(tmpdir(), `aurix-aliyun-${randomUUID()}`);
  const backgroundPath = join(directory, 'background.png');
  const piecePath = join(directory, 'piece.png');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const captureTimeout = Math.max(100, Math.min(1_500, deadline - Date.now()));
    const [backgroundImage, pieceImage] = await Promise.all([
      background.screenshot({ type: 'png', animations: 'disabled', timeout: captureTimeout }),
      piece.screenshot({
        type: 'png',
        omitBackground: true,
        animations: 'disabled',
        timeout: captureTimeout,
        style: '#aliyunCaptcha-img { visibility: hidden !important; } #aliyunCaptcha-window-puzzle { background: transparent !important; }',
      }),
    ]);
    await Promise.all([
      writeFile(backgroundPath, backgroundImage, { mode: 0o600 }),
      writeFile(piecePath, pieceImage, { mode: 0o600 }),
    ]);
    const remaining = deadline - Date.now();
    if (remaining < 100) return undefined;
    const detected = await detectAliyunGapOpenCv(
      backgroundPath,
      piecePath,
      3,
      Math.min(2_500, remaining),
      geometry.piece && geometry.background
        ? {
            pieceTop: geometry.piece.y - geometry.background.y,
            pieceWidth: geometry.piece.width,
            pieceHeight: geometry.piece.height,
            renderedBackgroundWidth: geometry.background.width,
            renderedBackgroundHeight: geometry.background.height,
          }
        : undefined
    );
    if (!detected.ok || !detected.candidates?.length || !detected.backgroundWidth || !geometry.background) return undefined;
    const candidate = detected.candidates[0];
    return {
      gapX: scaleAliyunGapCoordinate(candidate.gapX, detected.backgroundWidth, geometry.background.width),
      confidence: candidate.confidence,
      method: detected.method || 'opencv',
    };
  } finally {
    if (process.env.AURIX_ALIYUN_DEBUG !== '1') await rm(directory, { recursive: true, force: true }).catch(() => {});
    else console.error(`[aliyun] debug captures preserved: ${directory}`);
  }
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
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const points = buildAliyunDragTrajectory(start, clamped);
  for (let index = 0; index < points.length; index++) {
    if (Date.now() >= deadline) {
      await page.mouse.up().catch(() => {});
      throw new Error('Aliyun solve deadline exhausted during drag');
    }
    await page.mouse.move(points[index].x, points[index].y);
    await page.waitForTimeout(index < 4 ? 5 + (index % 2) * 2 : 8 + Math.random() * 4);
  }
  await page.waitForTimeout(70 + Math.random() * 50);
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
  if (opened) {
    const readyDeadline = Date.now() + 1_500;
    while (Date.now() < readyDeadline) {
      if (await readGeometry(page)) break;
      await page.waitForTimeout(50);
    }
  }
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
  const maxAttempts = Math.max(1, Math.min(3, options.maxAttempts ?? 1));
  const deadline = options.deadlineMs ?? Date.now() + 10_000;
  const debug = process.env.AURIX_ALIYUN_DEBUG === '1';
  const startedAt = Date.now();
  const logDebug = (message: string) => {
    if (debug) console.error(`[aliyun +${Date.now() - startedAt}ms] ${message}`);
  };
  if (await hasAliyunSuccess(page)) return '[OK] Aliyun Captcha 2.0 verified';
  let completedAttempts = 0;

  for (let attempt = 0; attempt < maxAttempts && Date.now() < deadline; attempt++) {
    completedAttempts++;
    await clearAliyunAttemptState(page);
    let type = await classifyAliyunCaptcha(page);
    if (type === 'TRACELESS') {
      await openAliyunChallenge(page);
      type = await classifyAliyunCaptcha(page);
    }
    logDebug(`challenge type ${type}`);
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
      if (!geometry) return '[ERROR] Aliyun Captcha 2.0 slider is not ready';
      let distance: number;
      if (type === 'SLIDE') {
        distance = geometry.trackWidth;
      } else {
        const openCv = geometry.gapOffset === undefined
          ? await estimateGapWithOpenCv(page, geometry, deadline).catch(() => undefined)
          : undefined;
        const visionGap = geometry.gapOffset === undefined && !openCv
          ? await estimateGapWithVision(page, geometry, deadline)
          : undefined;
        const gapOffset = geometry.gapOffset ?? openCv?.gapX ?? visionGap;
        if (gapOffset === undefined) return '[ERROR] Aliyun Captcha 2.0 puzzle gap was not found';
        distance = invertAliyunDragDistance(Math.max(1, gapOffset));
        const method = geometry.gapOffset !== undefined ? 'dom' : openCv ? openCv.method : 'vision';
        logDebug(`gap ${Math.round(gapOffset)}px via ${method}; drag ${distance.toFixed(1)}px`);
      }
      await dragAliyun(page, geometry, distance, deadline);
    }
    let accepted = false;
    const acceptanceDeadline = Math.min(deadline, Date.now() + 2_500);
    while (Date.now() < acceptanceDeadline) {
      if (await hasAliyunSuccess(page)) {
        accepted = true;
        break;
      }
      await page.waitForTimeout(Math.min(75, Math.max(1, acceptanceDeadline - Date.now())));
    }
    if (accepted) {
      logDebug('application callback accepted');
      return '[OK] Aliyun Captcha 2.0 verified';
    }
    if (attempt < maxAttempts - 1) await refreshAliyun(page);
  }

  const reason = Date.now() >= deadline
    ? `timed out after ${completedAttempts} attempt(s)`
    : `was not confirmed after ${completedAttempts} attempt(s)`;
  return `[ERROR] Aliyun Captcha 2.0 ${reason}`;
}
