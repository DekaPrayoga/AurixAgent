import { type Frame, type Locator, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { humanMove } from './common.js';

const PIXELS_EXTENSION = 10;
const DEBUG_DIR = join(homedir(), '.aurix');

type Rect = { left: number; top: number; width: number; height: number };

type CanvasSnapshot = {
  selector: string;
  className: string;
  width: number;
  height: number;
  rect: Rect;
  alphaCoverage: number;
  data: number[];
};

type CanvasBundle = {
  background: CanvasSnapshot;
  piece: CanvasSnapshot;
  source: 'canvas' | 'element-screenshot';
  inventory: string[];
};

type MatchResult = {
  distanceCanvas: number;
  distanceCss: number;
  confidence: number;
  bestX: number;
  originX: number;
  pieceBox: { x: number; y: number; width: number; height: number };
  scale: number;
};

type VerifyResult = 'success' | 'fail' | 'unknown';
type FrameLike = Frame | Page;

type Candidate = {
  locator: Locator;
  selector: string;
  className: string;
  rect: Rect;
  area: number;
};

function ensureDebugDir(): void {
  if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function rgbaToGray(img: CanvasSnapshot): Float32Array {
  const gray = new Float32Array(img.width * img.height);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    const a = img.data[i + 3] / 255;
    gray[j] = (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) * a;
  }
  return gray;
}

function alphaMask(img: CanvasSnapshot): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 3, j = 0; i < img.data.length; i += 4, j++) {
    mask[j] = img.data[i] > 10 ? 1 : 0;
  }
  return mask;
}

function gaussian3x3(src: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const xm1 = Math.max(0, x - 1);
      const xp1 = Math.min(width - 1, x + 1);
      const ym1 = Math.max(0, y - 1);
      const yp1 = Math.min(height - 1, y + 1);
      const v =
        src[ym1 * width + xm1] +
        2 * src[ym1 * width + x] +
        src[ym1 * width + xp1] +
        2 * src[y * width + xm1] +
        4 * src[y * width + x] +
        2 * src[y * width + xp1] +
        src[yp1 * width + xm1] +
        2 * src[yp1 * width + x] +
        src[yp1 * width + xp1];
      out[y * width + x] = v / 16;
    }
  }
  return out;
}

function sobel(src: Float32Array, width: number, height: number): Float32Array {
  const blurred = gaussian3x3(src, width, height);
  const out = new Float32Array(src.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = blurred[(y - 1) * width + x - 1];
      const tc = blurred[(y - 1) * width + x];
      const tr = blurred[(y - 1) * width + x + 1];
      const ml = blurred[y * width + x - 1];
      const mr = blurred[y * width + x + 1];
      const bl = blurred[(y + 1) * width + x - 1];
      const bc = blurred[(y + 1) * width + x];
      const br = blurred[(y + 1) * width + x + 1];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      out[i] = Math.min(255, Math.abs(gx) * 0.5 + Math.abs(gy) * 0.5);
    }
  }
  return out;
}

function cropPiece(edge: Float32Array, mask: Uint8Array, width: number, height: number) {
  let xMin = width;
  let xMax = -1;
  let yMin = height;
  let yMax = -1;

  const scan = (useAlpha: boolean, threshold: number) => {
    xMin = width;
    xMax = -1;
    yMin = height;
    yMax = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const active = useAlpha ? mask[i] > 0 && edge[i] > threshold : edge[i] > threshold;
        if (!active) continue;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  };

  scan(true, 6);
  if (xMax < xMin || yMax < yMin || xMax - xMin < 8 || yMax - yMin < 8) scan(false, 12);
  if (xMax < xMin || yMax < yMin) throw new Error('could not crop GeeTest slice/piece pixels');

  xMin = clamp(xMin - 1, 0, width - 1);
  yMin = clamp(yMin - 1, 0, height - 1);
  xMax = clamp(xMax + 1, 0, width - 1);
  yMax = clamp(yMax + 1, 0, height - 1);

  return { xMin, xMax, yMin, yMax, width: xMax - xMin + 1, height: yMax - yMin + 1 };
}

function crop(
  src: Float32Array,
  srcW: number,
  x: number,
  y: number,
  width: number,
  height: number
): Float32Array {
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const srcStart = (y + row) * srcW + x;
    out.set(src.subarray(srcStart, srcStart + width), row * width);
  }
  return out;
}

function extendTemplate(src: Float32Array, width: number, height: number) {
  const outW = width + PIXELS_EXTENSION * 2;
  const outH = height + PIXELS_EXTENSION * 2;
  const out = new Float32Array(outW * outH);
  for (let y = 0; y < height; y++) {
    out.set(
      src.subarray(y * width, y * width + width),
      (y + PIXELS_EXTENSION) * outW + PIXELS_EXTENSION
    );
  }
  return { data: out, width: outW, height: outH };
}

function extendBackground(src: Float32Array, width: number, height: number) {
  const outH = height + PIXELS_EXTENSION * 2;
  const out = new Float32Array(width * outH);
  for (let y = 0; y < height; y++) {
    out.set(src.subarray(y * width, y * width + width), (y + PIXELS_EXTENSION) * width);
  }
  return { data: out, width, height: outH };
}

function templateMatchX(
  background: Float32Array,
  bgW: number,
  bgH: number,
  template: Float32Array,
  tW: number,
  tH: number
) {
  if (bgH < tH || bgW < tW)
    throw new Error(`template ${tW}x${tH} does not fit background ${bgW}x${bgH}`);

  const n = tW * tH;
  let sumT = 0;
  let sumT2 = 0;
  for (let i = 0; i < template.length; i++) {
    sumT += template[i];
    sumT2 += template[i] * template[i];
  }
  const varT = sumT2 - (sumT * sumT) / n;
  const normT = Math.sqrt(Math.max(varT, 1e-9));

  let bestX = 0;
  let bestScore = -Infinity;

  for (let x = 0; x <= bgW - tW; x++) {
    let sumB = 0;
    let sumB2 = 0;
    let sumTB = 0;
    for (let y = 0; y < tH; y++) {
      const bgRow = y * bgW + x;
      const tRow = y * tW;
      for (let tx = 0; tx < tW; tx++) {
        const b = background[bgRow + tx];
        const t = template[tRow + tx];
        sumB += b;
        sumB2 += b * b;
        sumTB += t * b;
      }
    }
    const varB = sumB2 - (sumB * sumB) / n;
    const denom = normT * Math.sqrt(Math.max(varB, 1e-9));
    const score = denom > 0 ? (sumTB - (sumT * sumB) / n) / denom : -Infinity;
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }

  return { x: bestX, score: bestScore };
}

function computeDistance(bundle: CanvasBundle): MatchResult {
  const pieceGray = rgbaToGray(bundle.piece);
  const bgGray = rgbaToGray(bundle.background);
  const pieceEdge = sobel(pieceGray, bundle.piece.width, bundle.piece.height);
  const bgEdge = sobel(bgGray, bundle.background.width, bundle.background.height);
  const pieceMask = alphaMask(bundle.piece);
  const pieceBox = cropPiece(pieceEdge, pieceMask, bundle.piece.width, bundle.piece.height);

  const templateRaw = crop(
    pieceEdge,
    bundle.piece.width,
    pieceBox.xMin,
    pieceBox.yMin,
    pieceBox.width,
    pieceBox.height
  );
  const template = extendTemplate(templateRaw, pieceBox.width, pieceBox.height);

  const bgScale = bundle.background.rect.width / bundle.background.width;
  const pieceScale = bundle.piece.rect.width / bundle.piece.width;
  const relativePieceY = Math.round(
    (bundle.piece.rect.top - bundle.background.rect.top) / bgScale +
      pieceBox.yMin * (pieceScale / bgScale)
  );
  const bgY = clamp(relativePieceY, 0, bundle.background.height - 1);
  const bgH = Math.min(Math.max(pieceBox.height, template.height), bundle.background.height - bgY);
  const bgRaw = crop(bgEdge, bundle.background.width, 0, bgY, bundle.background.width, bgH);
  const bg = extendBackground(bgRaw, bundle.background.width, bgH);

  const match = templateMatchX(
    bg.data,
    bg.width,
    bg.height,
    template.data,
    template.width,
    template.height
  );
  const targetCss = (match.x + PIXELS_EXTENSION) * bgScale;
  const originCss =
    bundle.piece.rect.left - bundle.background.rect.left + pieceBox.xMin * pieceScale;
  const distanceCss = targetCss - originCss;
  const distanceCanvas = distanceCss / bgScale;

  return {
    distanceCanvas,
    distanceCss,
    confidence: match.score,
    bestX: match.x,
    originX: pieceBox.xMin,
    pieceBox: {
      x: pieceBox.xMin,
      y: pieceBox.yMin,
      width: pieceBox.width,
      height: pieceBox.height,
    },
    scale: bgScale,
  };
}

async function collectCandidates(frame: FrameLike, selectors: string[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    const locator = frame.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 24);
    for (let i = 0; i < count; i++) {
      const item = locator.nth(i);
      const rect = await item.boundingBox().catch(() => null);
      if (!rect || rect.width < 8 || rect.height < 8) continue;
      const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const className = await item
        .evaluate((el) => String((el as HTMLElement).className || ''))
        .catch(() => '');
      candidates.push({
        locator: item,
        selector,
        className,
        rect: { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
        area: rect.width * rect.height,
      });
    }
  }
  return candidates;
}

async function decodeScreenshot(
  path: string,
  rect: Rect,
  selector: string,
  className: string
): Promise<CanvasSnapshot> {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let alpha = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 10) alpha++;
  return {
    selector,
    className,
    width: info.width,
    height: info.height,
    rect,
    alphaCoverage: alpha / (info.width * info.height),
    data: Array.from(data),
  };
}

async function screenshotCandidate(candidate: Candidate, name: string): Promise<CanvasSnapshot> {
  ensureDebugDir();
  const path = join(DEBUG_DIR, `geetest-${name}.png`);
  await candidate.locator.screenshot({ path, timeout: 3000 });
  return decodeScreenshot(path, candidate.rect, candidate.selector, candidate.className);
}

async function extractCanvasBundle(frame: FrameLike): Promise<CanvasBundle> {
  const bundle = await frame.evaluate(() => {
    type R = { left: number; top: number; width: number; height: number };
    type C = {
      selector: string;
      className: string;
      width: number;
      height: number;
      rect: R;
      alphaCoverage: number;
      data: number[];
    };

    const rectOf = (el: Element): R => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    };

    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el as HTMLElement);
      return (
        r.width > 20 &&
        r.height > 20 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0'
      );
    };

    const canvases: C[] = [];
    let unreadable = 0;
    let webgl = 0;
    for (const canvas of Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[]) {
      if (!visible(canvas) || canvas.width < 30 || canvas.height < 30) continue;
      const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
      if (gl) webgl++;
      try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          unreadable++;
          continue;
        }
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let alpha = 0;
        for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 10) alpha++;
        canvases.push({
          selector: canvas.id
            ? `#${canvas.id}`
            : canvas.className
              ? `canvas.${String(canvas.className).trim().split(/\s+/).join('.')}`
              : 'canvas',
          className: String(canvas.className || ''),
          width: canvas.width,
          height: canvas.height,
          rect: rectOf(canvas),
          alphaCoverage: alpha / (canvas.width * canvas.height),
          data: Array.from(image.data),
        });
      } catch {
        unreadable++;
      }
    }

    const scoreBg = (c: C) => {
      const cls = c.className.toLowerCase();
      let score = c.width + c.height;
      if (cls.includes('canvas_bg')) score += 1000;
      if (cls.includes('bg')) score += 400;
      if (cls.includes('fullbg')) score -= 700;
      if (cls.includes('slice') || cls.includes('piece') || cls.includes('cut')) score -= 900;
      if (c.alphaCoverage > 0.75) score += 300;
      return score;
    };
    const scorePiece = (c: C) => {
      const cls = c.className.toLowerCase();
      let score = c.width + c.height;
      if (cls.includes('slice')) score += 1000;
      if (cls.includes('piece')) score += 700;
      if (cls.includes('cut')) score += 350;
      if (cls.includes('bg') || cls.includes('fullbg')) score -= 900;
      if (c.alphaCoverage > 0.01 && c.alphaCoverage < 0.65) score += 300;
      return score;
    };

    const background = [...canvases].sort((a, b) => scoreBg(b) - scoreBg(a))[0];
    const piece = [...canvases]
      .filter((c) => c !== background)
      .sort((a, b) => scorePiece(b) - scorePiece(a))[0];
    const imgs = Array.from(document.querySelectorAll('img')).filter(visible).length;
    const cssBg = Array.from(document.querySelectorAll('[style], [class*="geetest"]')).filter(
      (el) => /url\(/.test(getComputedStyle(el as HTMLElement).backgroundImage || '') && visible(el)
    ).length;

    return {
      background,
      piece,
      inventory: [
        `readable canvases: ${canvases.length}`,
        `unreadable canvases: ${unreadable}`,
        `webgl canvases: ${webgl}`,
        `visible imgs: ${imgs}`,
        `css backgrounds: ${cssBg}`,
        ...canvases
          .slice(0, 6)
          .map(
            (c) =>
              `${c.className || '(canvas)'} ${c.width}x${c.height} alpha=${c.alphaCoverage.toFixed(2)}`
          ),
      ],
    };
  });

  if (!bundle?.background || !bundle?.piece) {
    const inventory = bundle?.inventory?.join('; ') || 'no DOM inventory';
    throw new Error(`no readable background/slice canvas (${inventory})`);
  }

  return {
    background: bundle.background,
    piece: bundle.piece,
    source: 'canvas',
    inventory: bundle.inventory || [],
  } as CanvasBundle;
}

async function extractScreenshotBundle(frame: FrameLike): Promise<CanvasBundle> {
  const bgSelectors = [
    '.geetest_canvas_bg',
    '.geetest_bg',
    'canvas[class*="bg"]',
    '[class*="canvas_bg"]',
    '[class*="image_bg"]',
    '[class*="captcha_bg"]',
    '[class*="geetest"] img',
    '[class*="geetest_panel"]',
    '[class*="geetest_box"]',
    '[class*="geetest_window"]',
  ];
  const pieceSelectors = [
    '.geetest_canvas_slice',
    '.geetest_slice',
    '.geetest_piece',
    '.geetest_cut',
    '[class*="canvas_slice"]',
    '[class*="slider_piece"]',
    '[class*="slice"]',
    '[class*="piece"]',
    '[class*="cut"]',
  ];

  const bgCandidates = (await collectCandidates(frame, bgSelectors))
    .filter((c) => !/slice|piece|cut|slider_button|btn/i.test(c.className))
    .sort((a, b) => b.area - a.area);
  const pieceCandidates = (await collectCandidates(frame, pieceSelectors))
    .filter((c) => !/fullbg|refresh|slider_track|track/i.test(c.className))
    .sort((a, b) => {
      const score = (c: Candidate) => {
        let s = 0;
        if (/slice/i.test(c.className)) s += 1000;
        if (/piece/i.test(c.className)) s += 700;
        if (/cut/i.test(c.className)) s += 450;
        if (
          c.rect.width >= 15 &&
          c.rect.width <= 140 &&
          c.rect.height >= 15 &&
          c.rect.height <= 140
        )
          s += 250;
        s -= Math.abs(c.area - 2500) / 100;
        return s;
      };
      return score(b) - score(a);
    });

  const bg = bgCandidates[0];
  const piece = pieceCandidates[0];
  if (!bg || !piece) {
    throw new Error(
      `screenshot fallback missing candidates (background=${bgCandidates.length}, piece=${pieceCandidates.length})`
    );
  }

  const background = await screenshotCandidate(bg, 'background');
  const pieceShot = await screenshotCandidate(piece, 'piece');
  return {
    background,
    piece: pieceShot,
    source: 'element-screenshot',
    inventory: [
      `screenshot fallback: background=${bg.className || bg.selector} ${Math.round(bg.rect.width)}x${Math.round(bg.rect.height)}`,
      `screenshot fallback: piece=${piece.className || piece.selector} ${Math.round(piece.rect.width)}x${Math.round(piece.rect.height)}`,
    ],
  };
}

async function extractBestBundle(frame: FrameLike, results: string[]): Promise<CanvasBundle> {
  try {
    const bundle = await extractCanvasBundle(frame);
    results.push(`Pixel source: readable canvas (${bundle.inventory.join('; ')})`);
    return bundle;
  } catch (e: any) {
    results.push(`Canvas read failed: ${e.message}`);
  }

  const bundle = await extractScreenshotBundle(frame);
  results.push(`Pixel source: element screenshot (${bundle.inventory.join('; ')})`);
  return bundle;
}

async function scoreFrame(frame: FrameLike, page: Page): Promise<number> {
  let score = 0;
  const url = 'url' in frame && typeof frame.url === 'function' ? frame.url() : page.url();
  if (/geetest|captcha/i.test(url)) score += 20;
  const bodyText = await frame
    .locator('body')
    .innerText({ timeout: 700 })
    .catch(() => '');
  if (/slide|verify|captcha|验证|滑动|try again/i.test(bodyText)) score += 10;
  score += Math.min(
    30,
    (await frame
      .locator(
        '.geetest_slider_button, .geetest_slider_btn, [class*="slider_button"], [class*="slider_btn"], [class*="slider-handle"]'
      )
      .count()
      .catch(() => 0)) * 30
  );
  score += Math.min(
    20,
    (await frame
      .locator('canvas')
      .count()
      .catch(() => 0)) * 4
  );
  score += Math.min(
    15,
    (await frame
      .locator('img')
      .count()
      .catch(() => 0)) * 2
  );
  score += Math.min(
    20,
    (await frame
      .locator('[class*="geetest"]')
      .count()
      .catch(() => 0)) * 2
  );
  return score;
}

async function findGeetestFrame(page: Page): Promise<FrameLike> {
  const frames: FrameLike[] = [page, ...page.frames().filter((f) => f !== page.mainFrame())];
  const scored: Array<{ frame: FrameLike; score: number }> = [];
  for (const frame of frames) scored.push({ frame, score: await scoreFrame(frame, page) });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].frame : page;
}

async function dragSlider(
  page: Page,
  frame: FrameLike,
  distance: number,
  offset: number
): Promise<void> {
  const handle = frame
    .locator(
      '.geetest_slider_button, .geetest_slider_btn, [class*="slider_button"], [class*="slider_btn"], [class*="slider-handle"]'
    )
    .first();
  const box = await handle.boundingBox().catch(() => null);
  if (!box) throw new Error('GeeTest slider handle not visible');

  const startX = box.x + box.width * (0.45 + Math.random() * 0.1);
  const startY = box.y + box.height * (0.45 + Math.random() * 0.1);
  const targetDistance = distance + offset;
  const endX = startX + targetDistance;

  await humanMove(startX, startY, page);
  await page.waitForTimeout(180 + Math.random() * 180);
  await page.mouse.down();
  await page.waitForTimeout(220 + Math.random() * 250);

  const steps = 36 + Math.floor(Math.random() * 20);
  const overshoot =
    Math.min(8, Math.max(2, Math.abs(targetDistance) * 0.025)) * (Math.random() > 0.5 ? 1 : -0.35);
  for (let i = 1; i <= steps; i++) {
    const raw = i / steps;
    const eased = raw < 0.62 ? 1.15 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    const easedClamped = Math.min(1, eased);
    const x = startX + targetDistance * easedClamped + Math.sin(i * 0.55) * 0.7;
    const y = startY + Math.sin(i * 0.27) * 0.9 + (Math.random() - 0.5) * 0.6;
    await page.mouse.move(x, y);
    const speed = 1 - Math.abs(raw - 0.55) * 1.8;
    await page.waitForTimeout(8 + Math.random() * 13 + Math.max(0, speed) * 12);
  }

  if (Math.abs(overshoot) > 1) {
    await page.mouse.move(endX + overshoot, startY + (Math.random() - 0.5) * 1.5);
    await page.waitForTimeout(70 + Math.random() * 70);
    await page.mouse.move(endX + (Math.random() - 0.5) * 1.2, startY + (Math.random() - 0.5) * 1.2);
  }
  await page.waitForTimeout(160 + Math.random() * 180);
  await page.mouse.up();
}

async function verify(frame: FrameLike): Promise<VerifyResult> {
  await frame.waitForTimeout(1200).catch(() => {});
  const state = await frame
    .evaluate(() => {
      const text = document.body?.innerText?.toLowerCase() || '';
      const visible = (sel: string) =>
        Array.from(document.querySelectorAll(sel)).some((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el as HTMLElement);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        });
      return {
        text,
        success: visible(
          '.geetest_success, .geetest_tip_success, [class*="success"], [class*="verified"]'
        ),
        fail: visible(
          '.geetest_fail, .geetest_tip_fail, [class*="fail"], [class*="error"], [class*="retry"]'
        ),
        slider: visible(
          '.geetest_slider_button, .geetest_slider_btn, [class*="slider_button"], [class*="slider_btn"]'
        ),
      };
    })
    .catch(() => ({ text: '', success: false, fail: false, slider: true }));

  if (state.success || /success|verified|passed|验证成功|通过验证/.test(state.text))
    return 'success';
  if (state.fail || /try again|failed|error|再试|失败|请重试/.test(state.text)) return 'fail';
  if (!state.slider) return 'success';
  return 'unknown';
}

async function refreshChallenge(frame: FrameLike): Promise<void> {
  const refresh = frame
    .locator('.geetest_refresh, [class*="refresh"], [aria-label*="refresh" i]')
    .first();
  if ((await refresh.count().catch(() => 0)) > 0) {
    await refresh.click({ timeout: 1500 }).catch(() => {});
    await frame.waitForTimeout(1200).catch(() => {});
  }
}

export async function solveGeetestSlider(page: Page): Promise<string> {
  ensureDebugDir();
  const results: string[] = ['GeeTest: native TS solver v2 (canvas first, screenshot fallback)'];
  const frame = await findGeetestFrame(page);
  const offsets = [0, -3, 3, -6, 6];
  let lastDistance = 0;

  for (let attempt = 0; attempt < offsets.length; attempt++) {
    if (attempt > 0) {
      results.push(`Retry ${attempt}/${offsets.length - 1} with offset ${offsets[attempt]}px...`);
      await refreshChallenge(frame);
    }

    let match: MatchResult;
    try {
      const bundle = await extractBestBundle(frame, results);
      match = computeDistance(bundle);
      lastDistance = match.distanceCss;
      results.push(
        `Match: source=${bundle.source}, distance=${match.distanceCss.toFixed(1)}px (${match.distanceCanvas.toFixed(1)} canvas px), confidence=${match.confidence.toFixed(3)}, piece=${match.pieceBox.width}x${match.pieceBox.height}, scale=${match.scale.toFixed(3)}`
      );
      if (!Number.isFinite(match.distanceCss) || match.distanceCss < 8 || match.distanceCss > 420) {
        throw new Error(`computed distance out of range: ${match.distanceCss}`);
      }
      if (match.confidence < 0.08) {
        results.push(
          `[WARN] Low template confidence (${match.confidence.toFixed(3)}); attempting drag anyway`
        );
      }
    } catch (e: any) {
      const screenshot = join(DEBUG_DIR, 'geetest-failed.png');
      await page.screenshot({ path: screenshot }).catch(() => {});
      results.push(`[ERROR] GeeTest pixel analysis failed: ${e.message}`);
      results.push(`Screenshot: ${screenshot}`);
      return results.join('\n');
    }

    try {
      await dragSlider(page, frame, match.distanceCss, offsets[attempt]);
    } catch (e: any) {
      results.push(`[ERROR] GeeTest drag failed: ${e.message}`);
      break;
    }

    const state = await verify(frame);
    results.push(`Verify state: ${state}`);
    if (state === 'success') {
      const screenshot = join(DEBUG_DIR, 'geetest-solved.png');
      await page.screenshot({ path: screenshot }).catch(() => {});
      results.push('[OK] GeeTest slider solved');
      results.push(`Screenshot: ${screenshot}`);
      return results.join('\n');
    }

    if (state === 'unknown') {
      results.push('Slider outcome unknown; retrying with adjusted offset.');
    }
  }

  const screenshot = join(DEBUG_DIR, 'geetest-failed.png');
  await page.screenshot({ path: screenshot }).catch(() => {});
  results.push(
    `[ERROR] GeeTest slider not confirmed after ${offsets.length} attempt(s). Last distance: ${lastDistance.toFixed(1)}px`
  );
  results.push(`Screenshot: ${screenshot}`);
  return results.join('\n');
}
