import { type Page } from 'playwright-core';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import sharp from 'sharp';

const _TRAINING_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'training');
import { loadConfig } from '../../agent/Config.js';

export function readFileBase64(path: string): string {
  return readFileSync(path).toString('base64');
}

export async function visionClassify(imageBase64: string, prompt: string): Promise<string> {
  const config = loadConfig();
  const visionModel = config.visionModel || config.model || 'gpt-4o';
  const visionBaseUrl = config.visionBaseUrl || config.baseUrl;
  const visionApiKey = config.visionApiKey || config.apiKey;

  const body = {
    model: visionModel,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
      ],
    }],
    max_tokens: 4096,
  };

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 90_000);

  try {
    const resp = await fetch(`${visionBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(visionApiKey ? { Authorization: `Bearer ${visionApiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
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
  } finally {
    clearTimeout(fetchTimeout);
  }
}

export async function analyzeTileCrops(
  gridScreenshotPath: string,
  gridRows: number,
  gridCols: number,
  objectName: string,
  actualTileCount: number,
  _dbg: (msg: string) => void,
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
  _dbg(`analyzeTileCrops: image ${imgW}x${imgH}, tile ${tileW}x${tileH}, grid ${gridRows}x${gridCols}`);

  const tileCrops: { idx: number; base64: string }[] = [];

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const idx = r * gridCols + c;
      if (idx >= actualTileCount) continue;

      const left = c * tileW;
      const top = r * tileH;
      const width = (c === gridCols - 1) ? imgW - left : tileW;
      const height = (r === gridRows - 1) ? imgH - top : tileH;

      try {
        const tileBuf = await sharp(gridScreenshotPath)
          .extract({ left, top, width, height })
          .png()
          .toBuffer();
        tileCrops.push({ idx, base64: tileBuf.toString('base64') });
      } catch {}
    }
  }

  _dbg(`analyzeTileCrops: ${tileCrops.length} tiles cropped, classifying in batches...`);

  const results: { idx: number; isMatch: boolean }[] = [];
  const BATCH_SIZE = 4;
  for (let i = 0; i < tileCrops.length; i += BATCH_SIZE) {
    const batch = tileCrops.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async ({ idx, base64 }) => {
      try {
        const prompt = `Look at this image tile from a reCAPTCHA grid. The task is to find tiles containing "${objectName}".

Does this image show ${objectName} (or a recognizable part of it, like a pole/sign/housing associated with ${objectName})?

- Answer YES if you can identify ${objectName} or a significant part of it
- Answer NO if it clearly does not contain ${objectName}

Answer with exactly one word: YES or NO`;

        const response = await visionClassify(base64, prompt);
        const isMatch = /\byes\b/i.test(response);
        _dbg(`analyzeTileCrops: tile ${idx} → ${isMatch ? 'YES' : 'NO'} (${response.substring(0, 40).trim()})`);
        return { idx, isMatch };
      } catch (e: any) {
        _dbg(`analyzeTileCrops: tile ${idx} failed: ${e.message}`);
        return { idx, isMatch: false };
      }
    }));
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
    const path = join(_TRAINING_DIR, 'captcha-training.json');
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {}
  return [];
}

export function saveCaptchaTraining(example: CaptchaTrainingExample) {
  try {
    if (!existsSync(_TRAINING_DIR)) mkdirSync(_TRAINING_DIR, { recursive: true });
    const path = join(_TRAINING_DIR, 'captcha-training.json');
    const data = loadCaptchaTraining();
    const existing = data.findIndex(e =>
      e.objectType && example.objectType &&
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

export function getTrainingHint(objectName: string, gridSize: string, tileCount: number): string {
  try {
    const data = loadCaptchaTraining();
    const objLower = objectName.toLowerCase();
    const relevant = data.filter(e => {
      const eObj = (e.objectType || e.instruction).toLowerCase();
      return eObj.includes(objLower) || objLower.includes(eObj) ||
        e.instruction.toLowerCase().includes(objLower);
    });
    if (relevant.length === 0) return '';

    const byGrid = relevant.filter(e => e.gridSize === gridSize || e.gridCount === tileCount);
    const pool = byGrid.length > 0 ? byGrid : relevant;

    const sorted = pool.sort((a, b) => (b.successCount || 1) - (a.successCount || 1));
    const top = sorted.slice(0, 5);

    const patternCounts = new Map<string, number>();
    for (const ex of top) {
      const key = `[${ex.matchedIndices.join(',')}]`;
      patternCounts.set(key, (patternCounts.get(key) || 0) + (ex.successCount || 1));
    }

    const patterns = [...patternCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (patterns.length === 0) return '';

    const avgCount = top.reduce((s, e) => s + e.matchedIndices.length, 0) / top.length;
    const hint = `\n\n[TRAINING DATA] You have solved "${objectName}" challenges ${relevant.length} times before.` +
      ` Typical answer has ~${avgCount.toFixed(1)} tiles selected.` +
      ` Most common patterns: ${patterns.map(([p, c]) => `${p} (${c}x)`).join(', ')}.` +
      ` Use this as guidance but always verify against the actual image.`;
    return hint;
  } catch { return ''; }
}

// TEMP: CapTCHAi training integration — REMOVE AFTER TRAINING
const CAPTCHAI_KEY = 'sm2ac441rbvjs1yecfec4tigl42e4jja';

export async function capthaiSolve(imageBase64: string, instruction: string, gridSize: string): Promise<number[] | null> {
  try {
    const form = new FormData();
    form.append('key', CAPTCHAI_KEY);
    form.append('method', 'base64');
    form.append('body', imageBase64);
    form.append('instructions', instruction);
    form.append('grid_size', gridSize);
    form.append('img_type', 'recaptcha');
    form.append('json', '1');

    const createResp = await fetch('https://ocr.captchaai.com/in.php', { method: 'POST', body: form });
    const createText = await createResp.text();
    console.error(`[CapTCHAi] create: ${createText.substring(0, 200)}`);
    const createJson = JSON.parse(createText) as any;
    if (createJson.status !== 1 || !createJson.request) {
      console.error(`[CapTCHAi] create failed: status=${createJson.status}, request=${createJson.request}`);
      return null;
    }

    const taskId = createJson.request;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollUrl = `https://ocr.captchaai.com/res.php?key=${CAPTCHAI_KEY}&action=get&id=${taskId}&json=1`;
      const pollResp = await fetch(pollUrl);
      const pollText = await pollResp.text();
      console.error(`[CapTCHAi] poll ${i}: ${pollText.substring(0, 200)}`);
      const pollJson = JSON.parse(pollText) as any;
      if (pollJson.status === 1) {
        const raw = pollJson.request;
        if (Array.isArray(raw)) return raw.map(Number);
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(Number);
          } catch {}
          const nums = raw.match(/\d+/g);
          return nums ? nums.map(Number) : null;
        }
        return null;
      }
    }
    return null;
  } catch { return null; }
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
    if (!existsSync(_TRAINING_DIR)) mkdirSync(_TRAINING_DIR, { recursive: true });
    const path = join(_TRAINING_DIR, 'captcha-training-capthai.json');
    let list: any[] = [];
    if (existsSync(path)) list = JSON.parse(readFileSync(path, 'utf-8'));
    list.push(data);
    if (list.length > 500) list.splice(0, list.length - 500);
    writeFileSync(path, JSON.stringify(list, null, 2));
  } catch {}
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

export async function humanMove(x: number, y: number, page: Page): Promise<void> {
  const mouse = page.mouse;
  const vp = page.viewportSize() || { width: 1280, height: 720 };

  const startX = Math.random() * vp.width * 0.3;
  const startY = Math.random() * vp.height * 0.3;

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
          if (await table.count() > 0 && await table.isVisible()) {
            const cells = await table.locator('td').all();
            const visible: any[] = [];
            for (const cell of cells) {
              try { if (await cell.isVisible()) visible.push(cell); } catch {}
            }
            if (visible.length >= 4) return visible;
          }
        } catch {}
      }
      const tables = await frame.locator('table').all();
      for (const table of tables) {
        try {
          if (!await table.isVisible()) continue;
          const cells = await table.locator('td').all();
          const visible: any[] = [];
          for (const cell of cells) {
            try { if (await cell.isVisible()) visible.push(cell); } catch {}
          }
          if (visible.length >= 4) return visible;
        } catch {}
      }
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
