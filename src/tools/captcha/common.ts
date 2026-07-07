import { type Page } from 'playwright-core';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import sharp from 'sharp';

export const TRAINING_DIR = join(
  dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
  'training'
);
import { loadConfig } from '../../agent/Config.js';
import { createProvider } from '../../providers/index.js';

export function readFileBase64(path: string): string {
  return readFileSync(path).toString('base64');
}

export async function visionClassify(imageBase64: string, prompt: string): Promise<string> {
  const config = loadConfig();
  const provider = createProvider({
    ...config,
    provider: config.visionProvider || config.provider,
    baseUrl: config.visionBaseUrl || config.baseUrl,
    apiKey: config.visionApiKey || config.apiKey,
    model: config.visionModel || config.model || 'gpt-4o',
    apiStyle: config.visionApiStyle || config.apiStyle,
    maxTokens: 4096,
    temperature: 0.1,
  });

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const response = await Promise.race([
        provider.chat([
          {
            role: 'user',
            content: prompt,
            images: [`data:image/png;base64,${imageBase64}`],
          },
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Vision API timeout')), 30_000)
        ),
      ]);
      const result = response.text.trim();
      if (result) return result;
      lastError = new Error('Vision API returned empty response');
    } catch (e: any) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (
        attempt < MAX_RETRIES &&
        /404|429|5\d\d|ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed|network|timeout|rate limit/i.test(
          lastError.message
        )
      ) {
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error('Vision API failed after retries');
}

export async function analyzeTileCrops(
  gridScreenshotPath: string,
  gridRows: number,
  gridCols: number,
  objectName: string,
  actualTileCount: number,
  _dbg: (msg: string) => void
): Promise<number[]> {
  _dbg('analyzeTileCrops: cropping grid into individual tiles...');

  const image = sharp(gridScreenshotPath);
  const meta = await image.metadata();
  const imgW = meta.width || 0;
  const imgH = meta.height || 0;
  if (imgW === 0 || imgH === 0) {
    _dbg('analyzeTileCrops: invalid image dimensions');
    return [];
  }

  const tileW = Math.floor(imgW / gridCols);
  const tileH = Math.floor(imgH / gridRows);
  _dbg(
    `analyzeTileCrops: image ${imgW}x${imgH}, tile ${tileW}x${tileH}, grid ${gridRows}x${gridCols}`
  );

  const tileCrops: { idx: number; base64: string }[] = [];

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const idx = r * gridCols + c;
      if (idx >= actualTileCount) continue;

      const left = c * tileW;
      const top = r * tileH;
      const width = c === gridCols - 1 ? imgW - left : tileW;
      const height = r === gridRows - 1 ? imgH - top : tileH;

      try {
        let tileBuf = await sharp(gridScreenshotPath)
          .extract({ left, top, width, height })
          .toBuffer();
        if (width < 600 || height < 600) {
          const upscale = Math.max(1, Math.floor(600 / Math.max(width, height)));
          tileBuf = await sharp(tileBuf)
            .resize(width * upscale, height * upscale, { kernel: sharp.kernel.lanczos3 })
            .normalize()
            .sharpen({ sigma: 2.0, m1: 0.5, m2: 1.0 })
            .modulate({ brightness: 1.1, saturation: 1.4 })
            .png()
            .toBuffer();
        } else {
          tileBuf = await sharp(tileBuf)
            .normalize()
            .sharpen({ sigma: 1.5, m1: 0.5, m2: 0.8 })
            .modulate({ brightness: 1.1, saturation: 1.4 })
            .png()
            .toBuffer();
        }
        tileCrops.push({ idx, base64: tileBuf.toString('base64') });
      } catch {}
    }
  }

  _dbg(`analyzeTileCrops: ${tileCrops.length} tiles cropped, classifying in batches...`);

  try {
    for (let i = 0; i < Math.min(3, tileCrops.length); i++) {
      writeFileSync(
        join(homedir(), `.aurix-tile-${i}.png`),
        Buffer.from(tileCrops[i].base64, 'base64')
      );
    }
  } catch {}

  const results: { idx: number; isMatch: boolean }[] = [];
  const BATCH_SIZE = 3;
  for (let i = 0; i < tileCrops.length; i += BATCH_SIZE) {
    const batch = tileCrops.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async ({ idx, base64 }) => {
        try {
          const objLower = objectName.toLowerCase();
          const hints: Record<string, string> = {
            bus: 'Buses: large vehicle with ROW of passenger windows, tall rectangular body, destination sign. NOT fire hydrants (small barrel on ground), NOT vans, NOT trucks, NOT cars.',
            car: 'Cars: passenger vehicle with 4 wheels, windshield, hood, trunk/hatch. Must see actual car body shape. NOT motorcycles, NOT buses, NOT trucks, NOT close-ups of single parts.',
            motorcycle:
              'Motorcycles: 2 wheels, visible engine block, gas tank, handlebars, exhaust pipe. Must see bike frame. NOT cars (4 wheels, enclosed), NOT bicycles (no engine/gas tank), NOT scooters.',
            bicycle:
              'Bicycles: 2 thin wheels, thin metal frame, pedals, NO engine, NO gas tank. NOT motorcycles (have engine), NOT scooters.',
            traffic_light:
              'Traffic lights: pole with 2-3 colored circles (red/yellow/green) stacked vertically. NOT street lamps (single white light on pole), NOT building lights.',
            fire_hydrant:
              'Fire hydrants: SHORT barrel-shaped object on ground/sidewalk, dome cap, 2-3 side nozzles/caps, bright red/yellow/orange. They are SMALL (knee-height). NOT buses, NOT vehicles, NOT mailboxes, NOT bollards.',
            crosswalk:
              'Crosswalks: white parallel stripes or zebra pattern PAINTED ON ROAD surface for pedestrians. NOT lane dividers, NOT road arrows, NOT regular pavement markings.',
            stairs:
              'Stairs: visible step edges with distinct risers and treads, ascending or descending. NOT ramps, NOT sloped surfaces, NOT escalators.',
          };
          let hint = '';
          for (const [key, h] of Object.entries(hints)) {
            if (objLower.includes(key.replace('_', ' ')) || objLower.includes(key)) {
              hint = `\n- ${h}`;
              break;
            }
          }

          const prompt = `You are solving a reCAPTCHA image challenge. The task: find tiles containing "${objectName}".
This is ONE tile from a grid. Each tile shows a real-world photo.

First, carefully describe what you see in detail. Then decide: does this tile contain ${objectName}?

Rules:
- YES if you can clearly identify ${objectName} in the image — you can see it with confidence
- YES if ${objectName} is partially visible but clearly identifiable (e.g., front half of a bus, partial view of a bicycle)
- NO if the tile shows only roads, sky, buildings, trees, or other objects without ${objectName}
- NO if you see a similar-looking but DIFFERENT object
- When you're not sure, say NO${hint}

Describe: [detailed description of what you see]
Answer: YES or NO`;

          const response = await visionClassify(base64, prompt);
          const answerLine =
            response.split('\n').find((l) => /^answer:/i.test(l.trim())) || response;
          let isMatch = /\byes\b/i.test(answerLine);
          const describeLine = response.split('\n').find((l) => /^describe:/i.test(l.trim())) || '';
          const descText = describeLine.replace(/^describe:\s*/i, '').toLowerCase();

          // Reject obvious hallucinations: if model says YES but description only
          // mentions clearly unrelated objects (no mention of target or related terms)
          if (isMatch) {
            const falsePositiveHints: Record<string, string[]> = {
              bus: ['only a car', 'only a van', 'only a truck', 'no bus'],
              motorcycle: ['only a car', 'only a bicycle', 'no motorcycle'],
              bicycle: ['only a motorcycle', 'only a car', 'no bicycle'],
              fire_hydrant: [
                'only a car',
                'only a bus',
                'only a building',
                'no hydrant',
                'no fire',
              ],
              car: ['only a motorcycle', 'only a bicycle', 'only a bus', 'no car'],
            };
            const fpHints =
              falsePositiveHints[objLower.replace(/\s+/g, '_')] ||
              falsePositiveHints[objLower] ||
              [];
            const hasFalsePositiveHint = fpHints.some((h) => descText.includes(h));
            if (hasFalsePositiveHint) {
              _dbg(`analyzeTileCrops: tile ${idx} YES but description contradicts — rejecting`);
              isMatch = false;
            }
          }

          _dbg(
            `analyzeTileCrops: tile ${idx} → ${isMatch ? 'YES' : 'NO'} (${describeLine.substring(0, 60).trim()})`
          );
          return { idx, isMatch };
        } catch (e: any) {
          _dbg(`analyzeTileCrops: tile ${idx} failed: ${e.message}`);
          return { idx, isMatch: false };
        }
      })
    );
    results.push(...batchResults);
  }
  const matched: number[] = [];
  for (const { idx, isMatch } of results) {
    if (isMatch) matched.push(idx);
  }

  _dbg(`analyzeTileCrops result: [${matched.join(',')}] from ${results.length} tiles`);
  return matched;
}

export interface CaptchaTrainingExample {
  instruction: string;
  objectType?: string;
  gridSize?: string;
  gridCount: number;
  matchedIndices: number[];
  tileCount?: number;
  visionResponse?: string;
  successCount?: number;
  timestamp: number;
}

export function loadCaptchaTraining(): CaptchaTrainingExample[] {
  try {
    const path = join(TRAINING_DIR, 'captcha-training.json');
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {}
  return [];
}

export function saveCaptchaTraining(example: CaptchaTrainingExample) {
  try {
    if (!existsSync(TRAINING_DIR)) mkdirSync(TRAINING_DIR, { recursive: true });
    const path = join(TRAINING_DIR, 'captcha-training.json');
    const data = loadCaptchaTraining();
    const existing = data.findIndex(
      (e) =>
        e.objectType &&
        example.objectType &&
        e.objectType.toLowerCase() === example.objectType.toLowerCase() &&
        e.gridSize === example.gridSize &&
        JSON.stringify(e.matchedIndices) === JSON.stringify(example.matchedIndices)
    );
    if (existing >= 0) {
      data[existing].successCount = (data[existing].successCount || 1) + 1;
      data[existing].timestamp = example.timestamp;
    } else {
      data.push({ ...example, successCount: 1 });
    }
    if (data.length > 200) data.splice(0, data.length - 200);
    writeFileSync(path, JSON.stringify(data, null, 2));
  } catch {}
}

export interface CaptchaResult {
  instruction: string;
  objectType: string;
  gridSize: string;
  tileCount: number;
  matchedIndices: number[];
  result: 'pass' | 'fail' | 'verified' | 'new_challenge';
  timestamp: number;
  source?: string;
  tileDescriptions?: { idx: number; description: string; selected: boolean }[];
  gridAnalysis?: { result: number[]; rawResponse?: string };
  perTileAnalysis?: { result: number[] };
  directAnalysis?: { result: number[] };
  verifyResults?: { idx: number; kept: boolean; description: string }[];
  mergeInfo?: string;
  gridImagePath?: string;
  is3x3Flip?: boolean;
  errorNotes?: string;
}

export function saveCaptchaResult(r: CaptchaResult) {
  try {
    if (!existsSync(TRAINING_DIR)) mkdirSync(TRAINING_DIR, { recursive: true });

    if (r.gridImagePath && existsSync(r.gridImagePath)) {
      try {
        const ext = r.result === 'fail' ? 'failed' : 'passed';
        const imgDest = join(
          TRAINING_DIR,
          `${ext}-${r.timestamp}-${r.objectType.replace(/\s/g, '_')}.png`
        );
        copyFileSync(r.gridImagePath, imgDest);
        r.gridImagePath = imgDest;
      } catch {}
    }

    if (r.result === 'fail' || r.result === 'new_challenge') {
      const path = join(TRAINING_DIR, 'failed-captcha.json');
      let list: CaptchaResult[] = [];
      if (existsSync(path)) {
        try {
          list = JSON.parse(readFileSync(path, 'utf-8'));
        } catch {}
      }
      list.push(r);
      if (list.length > 200) list.splice(0, list.length - 200);
      writeFileSync(path, JSON.stringify(list, null, 2));
    }

    if (r.result === 'pass' || r.result === 'verified') {
      const path = join(TRAINING_DIR, 'captcha-training.json');
      let list: any[] = [];
      if (existsSync(path)) {
        try {
          list = JSON.parse(readFileSync(path, 'utf-8'));
        } catch {}
      }
      const existing = list.findIndex(
        (e) =>
          e.objectType &&
          r.objectType &&
          e.objectType.toLowerCase() === r.objectType.toLowerCase() &&
          e.gridSize === r.gridSize &&
          JSON.stringify(e.matchedIndices) === JSON.stringify(r.matchedIndices)
      );
      if (existing >= 0) {
        list[existing].successCount = (list[existing].successCount || 1) + 1;
        list[existing].timestamp = r.timestamp;
      } else {
        list.push({ ...r, successCount: 1 });
      }
      if (list.length > 200) list.splice(0, list.length - 200);
      writeFileSync(path, JSON.stringify(list, null, 2));
    }
  } catch {}
}

export function getTrainingHint(objectName: string, gridSize: string, tileCount: number): string {
  try {
    const data = loadCaptchaTraining();
    const objLower = objectName.toLowerCase();
    const relevant = data.filter((e) => {
      const eObj = (e.objectType || e.instruction).toLowerCase();
      return (
        eObj.includes(objLower) ||
        objLower.includes(eObj) ||
        e.instruction.toLowerCase().includes(objLower)
      );
    });
    if (relevant.length === 0) return '';

    const byGrid = relevant.filter((e) => e.gridSize === gridSize || e.gridCount === tileCount);
    const pool = byGrid.length > 0 ? byGrid : relevant;

    const sorted = pool.sort((a, b) => (b.successCount || 1) - (a.successCount || 1));
    const top = sorted.slice(0, 5);

    const patternCounts = new Map<string, number>();
    for (const ex of top) {
      const key = `[${ex.matchedIndices.join(',')}]`;
      patternCounts.set(key, (patternCounts.get(key) || 0) + (ex.successCount || 1));
    }

    const patterns = [...patternCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

    if (patterns.length === 0) return '';

    const avgCount = top.reduce((s, e) => s + e.matchedIndices.length, 0) / top.length;
    const hint =
      `\n\n[TRAINING DATA] You have solved "${objectName}" challenges ${relevant.length} times before.` +
      ` Typical answer has ~${avgCount.toFixed(1)} tiles selected.` +
      ` Most common patterns: ${patterns.map(([p, c]) => `${p} (${c}x)`).join(', ')}.` +
      ` Use this as guidance but always verify against the actual image.`;
    return hint;
  } catch {
    return '';
  }
}

// TEMP: CapTCHAi training integration — REMOVE AFTER TRAINING
const CAPTCHAI_KEY = 'sm2ac441rbvjs1yecfec4tigl42e4jja';

export async function capthaiSolve(
  imageBase64: string,
  instruction: string,
  gridSize: string
): Promise<number[] | null> {
  try {
    const form = new FormData();
    form.append('key', CAPTCHAI_KEY);
    form.append('method', 'base64');
    form.append('body', imageBase64);
    form.append('instructions', instruction);
    form.append('grid_size', gridSize);
    form.append('img_type', 'recaptcha');
    form.append('json', '1');

    const createResp = await fetch('https://ocr.captchaai.com/in.php', {
      method: 'POST',
      body: form,
    });
    const createText = await createResp.text();
    console.error(`[CapTCHAi] create: ${createText.substring(0, 200)}`);
    let createJson: any;
    try {
      createJson = JSON.parse(createText);
    } catch {
      console.error(`[CapTCHAi] non-JSON create response`);
      return null;
    }
    if (createJson.status !== 1 || !createJson.request) {
      console.error(
        `[CapTCHAi] create failed: status=${createJson.status}, request=${createJson.request}`
      );
      return null;
    }

    const taskId = createJson.request;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollUrl = `https://ocr.captchaai.com/res.php?key=${CAPTCHAI_KEY}&action=get&id=${taskId}&json=1`;
      const pollResp = await fetch(pollUrl);
      const pollText = await pollResp.text();
      console.error(`[CapTCHAi] poll ${i}: ${pollText.substring(0, 200)}`);
      let pollJson: any;
      try {
        pollJson = JSON.parse(pollText);
      } catch {
        continue;
      }
      if (pollJson.status === 1) {
        const raw = pollJson.request;
        const convertToZeroIndexed = (arr: number[]) =>
          arr.map((n: number) => n - 1).filter((n: number) => n >= 0);
        if (Array.isArray(raw)) {
          const result = convertToZeroIndexed(raw.map(Number));
          return result.length > 0 ? result : null;
        }
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0)
              return convertToZeroIndexed(parsed.map(Number));
            if (Array.isArray(parsed) && parsed.length === 0) return null;
          } catch {}
          const nums = raw.match(/\d+/g);
          return nums ? convertToZeroIndexed(nums.map(Number)) : null;
        }
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCapthaiTraining(data: {
  objectType: string;
  gridSize: string;
  capthaiIndices: number[];
  visionIndices: number[];
  correct: boolean;
  timestamp: number;
}) {
  try {
    if (!existsSync(TRAINING_DIR)) mkdirSync(TRAINING_DIR, { recursive: true });
    const path = join(TRAINING_DIR, 'captcha-training-capthai.json');
    let list: any[] = [];
    if (existsSync(path)) list = JSON.parse(readFileSync(path, 'utf-8'));
    list.push(data);
    if (list.length > 500) list.splice(0, list.length - 500);
    writeFileSync(path, JSON.stringify(list, null, 2));
  } catch {}
}

export function getCapthaiCorrectionHint(objectName: string, gridSize: string): string {
  try {
    const path = join(TRAINING_DIR, 'captcha-training-capthai.json');
    if (!existsSync(path)) return '';
    const list: any[] = JSON.parse(readFileSync(path, 'utf-8'));
    const objLower = objectName.toLowerCase();
    const relevant = list
      .filter(
        (e) =>
          (e.objectType || '').toLowerCase().includes(objLower) ||
          objLower.includes((e.objectType || '').toLowerCase())
      )
      .filter((e) => !e.correct);

    if (relevant.length === 0) return '';

    const recent = relevant.slice(-5);
    const corrections = recent.map((e) => {
      const vision = `[${(e.visionIndices || []).join(',')}]`;
      const correct = `[${(e.capthaiIndices || []).join(',')}]`;
      const missed = (e.capthaiIndices || []).filter(
        (i: number) => !(e.visionIndices || []).includes(i)
      );
      const extra = (e.visionIndices || []).filter(
        (i: number) => !(e.capthaiIndices || []).includes(i)
      );
      return (
        `predicted ${vision}, correct was ${correct}` +
        (missed.length ? ` (missed: ${missed.join(',')})` : '') +
        (extra.length ? ` (extra: ${extra.join(',')})` : '')
      );
    });

    return (
      `\n\n[PAST CORRECTIONS] Your previous mistakes on "${objectName}" challenges:\n` +
      corrections.map((c, i) => `  ${i + 1}. ${c}`).join('\n') +
      `\nLearn from these errors. Pay attention to tiles you tend to miss or wrongly include.`
    );
  } catch {
    return '';
  }
}
// END TEMP: CapTCHAi training integration

export function bezierPoint(t: number, points: [number, number][]): [number, number] {
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

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

let _lastMousePos: [number, number] = [640, 360];

export async function humanMove(x: number, y: number, page: Page): Promise<void> {
  const mouse = page.mouse;
  const vp = page.viewportSize() || { width: 1280, height: 720 };

  const startX = _lastMousePos[0];
  const startY = _lastMousePos[1];

  const numControls = 2 + Math.floor(Math.random() * 3);
  const controlPoints: [number, number][] = [[startX, startY]];
  for (let i = 0; i < numControls; i++) {
    const frac = (i + 1) / (numControls + 1);
    const cx = startX + (x - startX) * frac + (Math.random() - 0.5) * 80;
    const cy = startY + (y - startY) * frac + (Math.random() - 0.5) * 60;
    controlPoints.push([cx, cy]);
  }
  controlPoints.push([x, y]);

  const totalSteps = 25 + Math.floor(Math.random() * 20);
  for (let step = 0; step <= totalSteps; step++) {
    const rawT = step / totalSteps;
    const t = easeInOut(rawT);
    const [px, py] = bezierPoint(t, controlPoints);

    const tremor = Math.sin(step * 0.3 + Math.random() * 0.5) * 0.4;
    const tremorY = Math.cos(step * 0.25 + Math.random() * 0.5) * 0.3;

    await mouse.move(px + tremor, py + tremorY);

    const speedFactor = 1 - Math.abs(rawT - 0.5) * 2;
    const delay = 8 + Math.random() * 12 + speedFactor * 5;
    await page.waitForTimeout(delay);
  }

  if (Math.random() > 0.6) {
    const overX = x + (Math.random() - 0.5) * 8;
    const overY = y + (Math.random() - 0.5) * 8;
    await mouse.move(overX, overY);
    await page.waitForTimeout(30 + Math.random() * 40);
    await mouse.move(x, y);
    await page.waitForTimeout(20 + Math.random() * 30);
  }

  _lastMousePos = [x, y];
}

let lastWarmupTime = 0;

export async function warmupBehavior(page: Page): Promise<void> {
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

export async function humanHold(x: number, y: number, duration: number, page: Page): Promise<void> {
  const mouse = page.mouse;
  const holdSteps = Math.floor(duration / 80);
  const breathFreq = 0.15 + Math.random() * 0.1;
  const breathAmpX = 0.3 + Math.random() * 0.4;
  const breathAmpY = 0.2 + Math.random() * 0.3;

  await mouse.down();

  for (let i = 0; i < holdSteps; i++) {
    const breathX = Math.sin(i * breathFreq) * breathAmpX;
    const breathY = Math.cos(i * breathFreq * 0.7) * breathAmpY;

    const adjX = Math.random() > 0.95 ? (Math.random() - 0.5) * 2 : 0;
    const adjY = Math.random() > 0.95 ? (Math.random() - 0.5) * 2 : 0;

    await mouse.move(x + breathX + adjX, y + breathY + adjY);
    await page.waitForTimeout(60 + Math.random() * 40);
  }

  await mouse.move(x + (Math.random() - 0.5) * 3, y - 1 - Math.random() * 2);
  await page.waitForTimeout(30 + Math.random() * 50);
  await mouse.up();
}

export async function humanClick(locator: any, page: Page): Promise<void> {
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

export async function humanClickAt(x: number, y: number, page: Page): Promise<void> {
  await humanMove(x, y, page);
  await page.waitForTimeout(40 + Math.random() * 80);
  await page.mouse.down();
  await page.waitForTimeout(50 + Math.random() * 100);
  await page.mouse.up();
}

export async function findGridTiles(frame: any, provider: string) {
  switch (provider) {
    case 'recaptcha': {
      const tableSelectors = [
        '.rc-imageselect-table-33',
        '.rc-imageselect-table-44',
        '.rc-image-tile-33',
        '.rc-image-tile-44',
      ];
      for (const sel of tableSelectors) {
        try {
          const table = frame.locator(sel).first();
          if ((await table.count()) > 0 && (await table.isVisible())) {
            const cells = await table.locator('td').all();
            const visible: any[] = [];
            for (const cell of cells) {
              try {
                if (await cell.isVisible()) visible.push(cell);
              } catch {}
            }
            if (visible.length >= 4) return visible;
          }
        } catch {}
      }
      const tables = await frame.locator('table').all();
      for (const table of tables) {
        try {
          if (!(await table.isVisible())) continue;
          const cells = await table.locator('td').all();
          const visible: any[] = [];
          for (const cell of cells) {
            try {
              if (await cell.isVisible()) visible.push(cell);
            } catch {}
          }
          if (visible.length >= 4) return visible;
        } catch {}
      }
      return [];
    }
    case 'hcaptcha': {
      const tiles = frame.locator('.task-image, .image, .task .answer');
      if ((await tiles.count()) > 0) return tiles.all();
      return [];
    }
    case 'mtcaptcha':
    case 'geetest': {
      const items = frame.locator('.geetest_item_wrap, .geetest_ques_tips img, .mtcaptcha-item');
      if ((await items.count()) > 0) return items.all();
      return [];
    }
    default: {
      const tiles = frame.locator(
        '.task-image, .rc-imageselect-table-33 td, .rc-imageselect-table-44 td, table td'
      );
      if ((await tiles.count()) > 0) return tiles.all();
      return [];
    }
  }
}
