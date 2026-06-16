import { homedir } from 'os';
import { join } from 'path';
import { readdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from 'fs';
import sharp from 'sharp';
import { visionClassify, readFileBase64, saveCaptchaTraining, findGridTiles, getTrainingHint, capthaiSolve, saveCapthaiTraining } from './common.js';

export async function solveCaptchaGrid(page: any, frame: any, provider: string): Promise<string> {
  const results: string[] = [];
  const isRecaptcha = provider === 'recaptcha';
  const _t0 = Date.now();
  const _elapsed = () => ((Date.now() - _t0) / 1000).toFixed(1);
  const _dbg = (msg: string) => {
    const line = `[${_elapsed()}s] ${msg}\n`;
    try { appendFileSync('/tmp/captcha-debug.log', line); } catch {}
    results.push(msg);
  };
  try { appendFileSync('/tmp/captcha-debug.log', `\n=== solveCaptchaGrid start (${provider}) ===\n`); } catch {}

  let instruction = '';
  try {
    await page.waitForTimeout(3000);
    _dbg(`frame url: ${frame.url().substring(0, 120)}`);

    for (let waitRetry = 0; waitRetry < 3; waitRetry++) {
      try { await frame.locator('.rc-imageselect-instructions, .prompt-text, .prompt-text-h').first().waitFor({ state: 'visible', timeout: 5000 }); break; } catch {
        if (waitRetry < 2) { _dbg(`waiting for challenge render (retry ${waitRetry + 1})...`); await page.waitForTimeout(2000); }
      }
    }

    const instrEl = frame.locator('.rc-imageselect-instructions, .prompt-text, .prompt-text-h, .rc-imageselect-payload-info, .geetest_tip_content, .mtcaptcha-label');
    if (await instrEl.count() > 0) {
      instruction = (await instrEl.first().textContent() || '').trim();
      _dbg(`extraction method 1 (locator): "${instruction.substring(0, 80)}"`);
    }

    if (!instruction) {
      const strongText = frame.locator('strong').first();
      if (await strongText.count() > 0) instruction = (await strongText.textContent() || '').trim();
      if (instruction) _dbg(`extraction method 2 (strong): "${instruction.substring(0, 80)}"`);
    }

    if (!instruction) {
      try {
        instruction = await frame.evaluate(() => {
          const selectors = ['.rc-imageselect-instructions', '.prompt-text', '.prompt-text-h', '.rc-imageselect-desc', 'strong', 'h2', '.rc-imageselect-payload-info'];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
          }
          return '';
        });
        if (instruction) _dbg(`extraction method 3 (evaluate): "${instruction.substring(0, 80)}"`);
      } catch (e: any) { _dbg(`extraction method 3 error: ${e.message?.substring(0, 60)}`); }
    }

    if (!instruction) {
      const allText = await frame.locator('body').textContent().catch(() => '');
      _dbg(`frame body text (${(allText || '').length} chars): "${(allText || '').substring(0, 200).replace(/\s+/g, ' ')}"`);
      if (allText) {
        const match = allText.match(/Select all (?:squares|images|areas|tiles)[^.!\n]{1,80}/i)
          || allText.match(/(?:click|tap|choose|find|identify)[^.!\n]{1,80}(?:traffic|bus|bicycle|car|boat|bridge|crosswalk|fire|mountain|palm|stair|taxi|motorcycle|hydrant|sign|light)/i);
        if (match) instruction = match[0].trim();
        if (instruction) _dbg(`extraction method 4 (body regex): "${instruction.substring(0, 80)}"`);
      }
    }

    if (!instruction) {
      for (const f of page.frames()) {
        if (f === frame) continue;
        try {
          const txt = await f.evaluate(() => {
            const selectors = ['.rc-imageselect-instructions', '.prompt-text', '.prompt-text-h', 'strong', 'h2'];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent && el.textContent.trim().length > 5) return el.textContent.trim();
            }
            const body = document.body?.textContent || '';
            const m = body.match(/Select all (?:squares|images|areas)[^.!\n]{1,80}/i);
            return m ? m[0].trim() : '';
          });
          if (txt && txt.length > 5) {
            instruction = txt;
            _dbg(`extraction method 5 (other frame ${f.url().substring(0, 60)}): "${instruction.substring(0, 80)}"`);
            break;
          }
        } catch {}
      }
    }

    if (!instruction) {
      try {
        const nestedFrames = await frame.locator('iframe').all();
        _dbg(`nested iframes in bframe: ${nestedFrames.length}`);
        for (const nf of nestedFrames) {
          const nfHandle = await nf.elementHandle();
          if (!nfHandle) continue;
          const nfFrame = await nfHandle.contentFrame();
          if (!nfFrame) continue;
          const txt = await nfFrame.evaluate(() => {
            const el = document.querySelector('.rc-imageselect-instructions, .prompt-text, strong, h2');
            return el ? (el.textContent || '').trim() : '';
          });
          if (txt && txt.length > 5) {
            instruction = txt;
            _dbg(`extraction method 6 (nested iframe): "${instruction.substring(0, 80)}"`);
            break;
          }
        }
      } catch (e: any) { _dbg(`extraction method 6 error: ${e.message?.substring(0, 60)}`); }
    }
  } catch (e: any) { _dbg(`instruction extraction outer error: ${e.message?.substring(0, 80)}`); }

  if (instruction && instruction.length < 10 && !/select|choose|find|click/i.test(instruction)) {
    _dbg(`instruction too short/invalid: "${instruction}", retrying extraction...`);
    instruction = '';
  }

  if (!instruction) {
    await page.waitForTimeout(3000);
    try {
      instruction = await frame.evaluate(() => {
        const el = document.querySelector('.rc-imageselect-instructions, .prompt-text, .prompt-text-h, strong');
        return el ? (el.textContent || '').trim() : '';
      });
      if (instruction && instruction.length < 10 && !/select|choose|find|click/i.test(instruction)) instruction = '';
    } catch {}
  }

  if (!instruction) {
    _dbg('Could not extract captcha instruction');
    results.push('[WARN] Could not extract captcha instruction, cannot auto-solve');
    return results.join('\n');
  }

  results.push(`Auto-solving: "${instruction}"`);
  _dbg(`instruction: "${instruction}"`);

  try {
    const home = homedir();
    for (const f of readdirSync(home)) {
      if (/^\.aurix-tile-(\d+|after-\d+)\.png$/.test(f)) {
        try { unlinkSync(join(home, f)); } catch {}
      }
    }
  } catch {}

  let tiles = await findGridTiles(frame, provider);
  for (let retry = 0; tiles.length === 0 && retry < 3; retry++) {
    _dbg(`waiting for tiles (retry ${retry + 1}/3)...`);
    await page.waitForTimeout(2000);
    tiles = await findGridTiles(frame, provider);
  }
  _dbg(`found ${tiles.length} tiles`);

  const cleanInstruction = instruction.replace(/If there are none.*$/i, '').replace(/Click verify once.*$/i, '').trim();
  const objectMatch = cleanInstruction.match(/(?:Select all (?:squares|images) with(?: a)?|select all images with(?: a)?)\s+(.+)/i);
  const objectName = objectMatch ? objectMatch[1].trim() : cleanInstruction;

  const is3x3 = tiles.length <= 9;
  let gridCols = is3x3 ? 3 : 4;
  let gridRows = is3x3 ? 3 : 4;
  let visibleTiles: any[] = tiles;
  let actualTileCount = tiles.length;

  try {
    const tileBoxes: { tile: any; box: { x: number; y: number; width: number; height: number } }[] = [];
    for (const tile of tiles) {
      try {
        const box = await tile.boundingBox();
        if (box && box.width > 5 && box.height > 5) tileBoxes.push({ tile, box });
      } catch {}
    }
    if (tileBoxes.length >= 4) {
      const firstY = tileBoxes[0].box.y;
      const yTol = 15;
      const firstRowTiles = tileBoxes.filter(tb => Math.abs(tb.box.y - firstY) < yTol);
      const detectedCols = firstRowTiles.length;

      const firstX = tileBoxes[0].box.x;
      const xTol = 15;
      const firstColTiles = tileBoxes.filter(tb => Math.abs(tb.box.x - firstX) < xTol);
      const detectedRows = firstColTiles.length;

      if (detectedCols >= 2 && detectedRows >= 2) {
        gridCols = detectedCols;
        gridRows = detectedRows;
        const expectedVisible = gridRows * gridCols;
        const lastVisibleX = tileBoxes[gridCols - 1].box.x + tileBoxes[gridCols - 1].box.width;
        const lastVisibleY = tileBoxes[(gridRows - 1) * gridCols]
          ? tileBoxes[(gridRows - 1) * gridCols].box.y + tileBoxes[(gridRows - 1) * gridCols].box.height
          : tileBoxes[tileBoxes.length - 1].box.y + tileBoxes[tileBoxes.length - 1].box.height;
        const vis: any[] = [];
        for (const tb of tileBoxes) {
          const cx = tb.box.x + tb.box.width / 2;
          const cy = tb.box.y + tb.box.height / 2;
          if (cx < lastVisibleX + 10 && cy < lastVisibleY + 10) vis.push(tb.tile);
        }
        if (vis.length >= 4 && vis.length !== tiles.length) {
          visibleTiles = vis;
          actualTileCount = vis.length;
        } else {
          actualTileCount = tileBoxes.length;
        }
        _dbg(`grid layout: ${gridRows}x${gridCols} (${actualTileCount} visible/${tiles.length} DOM, position-based)`);
      } else {
        _dbg(`grid layout: ${gridRows}x${gridCols} (${tiles.length} tiles, position detect: cols=${detectedCols} rows=${detectedRows})`);
      }
    } else {
      _dbg(`grid layout: ${gridRows}x${gridCols} (${tiles.length} tiles, insufficient boxes)`);
    }
  } catch (e: any) {
    _dbg(`grid layout fallback: ${gridRows}x${gridCols} (${tiles.length} tiles, ${e.message})`);
  }

  let gridSize = `${gridRows}x${gridCols}`;

  const gridScreenshotPath = join(homedir(), '.aurix-captcha-grid.png');
  let gridShot = false;
  let gridShotFromTable = false;

  _dbg('extracting tile images from DOM via frame.evaluate...');
  try {
    const tileDataUrls = await frame.evaluate(async (expectedCount: number) => {
      const tables = document.querySelectorAll('table');
      let cells: Element[] = [];
      for (const table of tables) {
        const tds = Array.from(table.querySelectorAll('td'));
        if (tds.length >= expectedCount) { cells = tds; break; }
        if (tds.length >= 4 && tds.length > cells.length) cells = tds;
      }
      if (cells.length === 0) return { error: 'no table cells found', cellCount: 0, imgCount: 0 };

      const firstImg = cells[0].querySelector('img') as HTMLImageElement | null;
      const isSprite = firstImg && firstImg.naturalWidth > 0 &&
        cells.every(c => {
          const img = c.querySelector('img') as HTMLImageElement | null;
          return img && img.src === firstImg.src;
        });

      const results: string[] = [];
      const cols = cells.length <= 9 ? 3 : 4;
      const rows = Math.ceil(cells.length / cols);
      const debugInfo: any[] = [];

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const img = cell.querySelector('img') as HTMLImageElement | null;
        if (img && img.complete && img.naturalWidth > 0) {
          if (isSprite) {
            try {
              const cs = getComputedStyle(img);
              const wrapper = cell.querySelector('.rc-image-tile-wrapper') as HTMLElement;
              const wcs = wrapper ? getComputedStyle(wrapper) : null;
              const wW = wrapper ? parseInt(wcs!.width) || 95 : 95;
              const wH = wrapper ? parseInt(wcs!.height) || 95 : 95;

              let imgLeft = parseInt(cs.left) || 0;
              let imgTop = parseInt(cs.top) || 0;
              const imgML = parseInt(cs.marginLeft) || 0;
              const imgMT = parseInt(cs.marginTop) || 0;
              const transform = cs.transform;
              let tx = 0, ty = 0;
              if (transform && transform !== 'none') {
                const m = transform.match(/matrix\(([^)]+)\)/);
                if (m) { const v = m[1].split(',').map(Number); tx = v[4] || 0; ty = v[5] || 0; }
              }

              const offX = imgLeft + imgML + tx;
              const offY = imgTop + imgMT + ty;
              const scale = img.naturalWidth / (parseInt(cs.width) || img.offsetWidth || wW);

              const sx = Math.max(0, -offX * scale);
              const sy = Math.max(0, -offY * scale);
              const sw = wW * scale;
              const sh = wH * scale;

              if (i < 4) {
                debugInfo.push({
                  i, left: imgLeft, top: imgTop, ml: imgML, mt: imgMT,
                  tx, ty, offX, offY, scale: +scale.toFixed(3),
                  sx: Math.round(sx), sy: Math.round(sy), sw: Math.round(sw), sh: Math.round(sh),
                  cssWidth: cs.width, cssHeight: cs.height, position: cs.position,
                  natW: img.naturalWidth, natH: img.naturalHeight,
                  class: img.className
                });
              }

              const canvas = document.createElement('canvas');
              canvas.width = Math.round(sw);
              canvas.height = Math.round(sh);
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
                results.push(canvas.toDataURL('image/png'));
                continue;
              }
            } catch {}
          } else {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0);
                results.push(canvas.toDataURL('image/png'));
                continue;
              }
            } catch {}
          }
          try {
            const resp = await fetch(img.src);
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = '';
            for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
            results.push('data:image/png;base64,' + btoa(binary));
            continue;
          } catch {}
        }
        results.push('');
      }
      return { results, cellCount: cells.length, imgCount: results.filter(r => r).length, debugInfo };
    }, actualTileCount);

    _dbg(`DOM extract: ${tileDataUrls.cellCount} cells, ${tileDataUrls.imgCount} images`);
    if ((tileDataUrls as any).debugInfo?.length) {
      _dbg(`sprite debug (first 4): ${JSON.stringify((tileDataUrls as any).debugInfo)}`);
    }

    try {
      const domInfo = await frame.evaluate((count: number) => {
        const tables = document.querySelectorAll('table');
        let cells: Element[] = [];
        for (const table of tables) {
          const tds = Array.from(table.querySelectorAll('td'));
          if (tds.length >= count) { cells = tds; break; }
        }
        return cells.slice(0, 4).map((cell, i) => {
          const img = cell.querySelector('img') as HTMLImageElement | null;
          const bg = getComputedStyle(cell).backgroundImage;
          const bgInner = cell.querySelector('[style*="background"]') as HTMLElement | null;
          const bgStyle = bgInner ? getComputedStyle(bgInner).backgroundImage : '';
          const bgPos = bgInner ? getComputedStyle(bgInner).backgroundPosition : '';
          const bgSize = bgInner ? getComputedStyle(bgInner).backgroundSize : '';
          return {
            i,
            imgSrc: img ? img.src.substring(0, 80) : null,
            imgW: img?.naturalWidth,
            imgH: img?.naturalHeight,
            imgDisplay: img ? getComputedStyle(img).display : null,
            bg: bg !== 'none' ? bg.substring(0, 80) : null,
            bgStyle: bgStyle !== 'none' ? bgStyle.substring(0, 80) : null,
            bgPos,
            bgSize,
            cellHTML: cell.innerHTML.substring(0, 200),
          };
        });
      }, actualTileCount);
      _dbg(`DOM info (first 4): ${JSON.stringify(domInfo).substring(0, 500)}`);
    } catch {}

    if (tileDataUrls.imgCount && tileDataUrls.imgCount >= actualTileCount * 0.5) {
      const tileBufs: { idx: number; buf: Buffer }[] = [];
      const dataResults = (tileDataUrls as any).results as string[];
      for (let i = 0; i < Math.min(dataResults.length, actualTileCount); i++) {
        const entry = dataResults[i];
        if (!entry || !entry.startsWith('data:image/')) continue;
        try {
          const b64 = entry.split(',')[1];
          if (b64) tileBufs.push({ idx: i, buf: Buffer.from(b64, 'base64') });
        } catch (e: any) { _dbg(`tile ${i} decode failed: ${e.message?.substring(0, 60)}`); }
      }

      if (tileBufs.length >= actualTileCount) {
        try {
          const meta0 = await sharp(tileBufs[0].buf).metadata();
          const tw = meta0.width || 100, th = meta0.height || 100;
          const gridW = tw * gridCols, gridH = th * gridRows;
          const composites: any[] = [];
          for (const { idx, buf } of tileBufs) {
            const r = Math.floor(idx / gridCols), c = idx % gridCols;
            composites.push({ input: buf, left: c * tw, top: r * th });
          }
          const composedBuf = await sharp({ create: { width: gridW, height: gridH, channels: 3, background: { r: 200, g: 200, b: 200 } } })
            .composite(composites).png().toBuffer();
          await sharp(composedBuf).toFile(gridScreenshotPath);
          const stats = await sharp(composedBuf).stats();
          const meanAll = stats.channels.reduce((s: number, c: any) => s + c.mean, 0) / stats.channels.length;
          if (composedBuf.length > 5000 && meanAll < 250) {
            gridShot = true;
            gridShotFromTable = true;
            _dbg(`composed grid from DOM: ${gridW}x${gridH} (buf=${composedBuf.length}, mean=${meanAll.toFixed(1)})`);
          } else {
            _dbg(`DOM composed grid blank (buf=${composedBuf.length}, mean=${meanAll.toFixed(1)})`);
          }
        } catch (e: any) { _dbg(`DOM compose failed: ${e.message}`); }
      } else {
        _dbg(`DOM extract: only ${tileBufs.length}/${actualTileCount} tiles`);
      }
    }
  } catch (e: any) { _dbg(`DOM extract error: ${e.message?.substring(0, 80)}`); }

  if (!gridShot) {
    _dbg('DOM extract failed, trying fallback screenshots...');

    const tryShot = async (label: string, fn: () => Promise<void>): Promise<boolean> => {
      try {
        await fn();
        const buf = readFileSync(gridScreenshotPath);
        if (buf.length < 2000) { _dbg(`${label}: too small (${buf.length}b), skipping`); return false; }
        const stats = await sharp(buf).stats();
        const mean = stats.channels.reduce((s: number, c: any) => s + c.mean, 0) / stats.channels.length;
        if (mean > 250) { _dbg(`${label}: blank (mean=${mean.toFixed(1)}), skipping`); return false; }
        _dbg(`${label}: OK (${buf.length}b, mean=${mean.toFixed(1)})`);
        return true;
      } catch (e: any) { _dbg(`${label}: error ${e.message?.substring(0, 60)}`); return false; }
    };

    if (!gridShot && await tryShot('iframe-html', async () => {
      await frame.locator('html').screenshot({ path: gridScreenshotPath, timeout: 10000 });
    })) gridShot = true;

    if (!gridShot) {
      try {
        const iframeEl = page.frameLocator('iframe[src*="recaptcha"]').first().locator('html');
        if (await iframeEl.count() > 0) {
          if (await tryShot('iframe-from-parent', async () => {
            await iframeEl.screenshot({ path: gridScreenshotPath, timeout: 10000 });
          })) gridShot = true;
        }
      } catch {}
    }

    if (!gridShot) {
      const tableSelectors = isRecaptcha
        ? (is3x3
            ? ['.rc-imageselect-table-33', '.rc-image-tile-33', 'table']
            : ['.rc-imageselect-table-44', '.rc-image-tile-44', 'table'])
        : ['.task', '.challenge-view'];
      for (const sel of tableSelectors) {
        if (gridShot) break;
        const el = frame.locator(sel).first();
        if (await el.count() > 0 && await el.isVisible()) {
          if (await tryShot(`selector:${sel}`, async () => {
            await el.screenshot({ path: gridScreenshotPath, timeout: 10000 });
          })) { gridShot = true; gridShotFromTable = true; }
        }
      }
    }

    if (!gridShot && await tryShot('frame-body', async () => {
      await frame.locator('body').screenshot({ path: gridScreenshotPath, timeout: 10000 });
    })) gridShot = true;

    if (!gridShot) {
      try {
        const iframeBox = await page.locator('iframe[src*="recaptcha"][src*="bframe"]').first().boundingBox();
        if (iframeBox) {
          await page.screenshot({ path: gridScreenshotPath, clip: iframeBox });
          const buf = readFileSync(gridScreenshotPath);
          if (buf.length >= 2000) {
            _dbg(`page-clip: OK (${buf.length}b)`);
            gridShot = true;
          } else {
            _dbg(`page-clip: too small (${buf.length}b)`);
          }
        }
      } catch {}
    }

    if (!gridShot) {
      try { await page.screenshot({ path: gridScreenshotPath }); gridShot = true; _dbg('grid screenshot: page fallback'); } catch {}
    }
  }

  if (gridShot) {
    try {
      const origMeta = await sharp(gridScreenshotPath).metadata();
      if ((origMeta.width || 0) > 0 && (origMeta.width || 0) < 200) {
        const upscaledPath = gridScreenshotPath + '.up.png';
        await sharp(gridScreenshotPath)
          .resize((origMeta.width || 0) * 2, (origMeta.height || 0) * 2, { kernel: sharp.kernel.lanczos3 })
          .png().toFile(upscaledPath);
        const upBuf = readFileSync(upscaledPath);
        writeFileSync(gridScreenshotPath, upBuf);
        try { unlinkSync(upscaledPath); } catch {}
        _dbg(`upscaled grid: ${origMeta.width}x${origMeta.height} → ${origMeta.width! * 2}x${origMeta.height! * 2}`);
      }
    } catch {}
  }

  const matchedIndices: number[] = [];

  if (gridShot) {
    try {
      let tileLayout = '';
      let idx = 0;
      for (let r = 0; r < gridRows; r++) {
        const rowTiles: string[] = [];
        for (let c = 0; c < gridCols; c++) {
          if (idx < actualTileCount) rowTiles.push(`[${idx}]`);
          idx++;
        }
        tileLayout += `Row ${r + 1}: ${rowTiles.join(' ')}\n`;
      }

      const trainingHint = getTrainingHint(objectName, gridSize, actualTileCount);
      if (trainingHint) _dbg(`training hint: ${trainingHint.substring(0, 100)}...`);

      const objectDescriptions: Record<string, string> = {
        'fire hydrant': 'a red/yellow fire hydrant (short metal post with side nozzles, usually red, sometimes yellow)',
        'traffic light': 'traffic signal lights AND their pole/housing/support structure (the pole holding the light counts as traffic light)',
        'traffic signal': 'traffic signal lights AND their pole/housing/support structure (the pole holding the light counts as traffic light)',
        'bus': 'a large passenger bus (city bus, school bus, coach — NOT cars or vans)',
        'bicycle': 'a bicycle/bike (two wheels, frame, handlebars — may be parked or being ridden)',
        'motorcycle': 'a motorcycle/motorbike (two wheels with engine, NOT bicycles)',
        'car': 'a car/automobile (sedan, SUV, coupe — NOT buses, trucks, or motorcycles)',
        'crosswalk': 'crosswalk markings on the road (white stripes/zebra pattern on pavement)',
        'stairs': 'stairs/staircase (steps going up or down, railings)',
        'mountain': 'mountains (large rocky landforms, peaks, ridges)',
        'palm tree': 'palm trees (tall trunk with fan/feather-shaped fronds at top)',
        'taxi': 'a taxi cab (car with taxi sign on roof, often yellow)',
        'bridge': 'a bridge structure (span over water/road/valley)',
        'chimney': 'a chimney (vertical structure on roof for smoke)',
        'boat': 'a boat/vessel on water',
        'parking meter': 'a parking meter (coin-operated device on sidewalk next to parking spot)',
      };
      const objDesc = objectDescriptions[objectName.toLowerCase()] || objectName;

      const sourceNote = gridShotFromTable
        ? 'The image shows ONLY the tile grid. Each cell in the grid is one tile.'
        : 'The image shows the full captcha frame. The tile grid is in the CENTER of the image. Ignore text/instructions above and buttons below the grid.';

      const prompt = `${sourceNote}

Grid layout: ${gridSize} (${actualTileCount} tiles, 0-indexed)
${tileLayout.trim()}

Task: Find tiles that show "${objectName}" — specifically: ${objDesc}

CRITICAL RULES:
- Typically 2-6 out of ${actualTileCount} tiles contain the target. Be SELECTIVE.
- Only YES if you CLEARLY see ${objectName} or a significant part of it in that tile.
- Supporting structures COUNT: poles/housings for traffic lights, frames/wheels for bicycles, etc.
- If uncertain about a tile, answer NO.
- DO NOT write long reasoning. Keep each tile note to 3 words maximum.

${trainingHint}

Respond EXACTLY in this format — no extra text:
Analysis: Tile 0: [yes/no - 3 words], Tile 1: [yes/no - 3 words], ..., Tile ${actualTileCount - 1}: [yes/no - 3 words]
Answer: [comma-separated numbers, or "none"]`;

      _dbg('calling visionClassify...');
      let gridBase64: string;
      try {
        const origBuf = await sharp(gridScreenshotPath).metadata();
        const targetDim = 800;
        const resized = await sharp(gridScreenshotPath).resize(targetDim, targetDim, { fit: 'inside' }).png().toBuffer();
        gridBase64 = resized.toString('base64');
        _dbg(`grid image ${origBuf.width}x${origBuf.height} → ${targetDim}x${targetDim} (${gridBase64.length} chars)`);
      } catch {
        gridBase64 = readFileBase64(gridScreenshotPath);
      }
      _dbg(`grid image loaded (${gridBase64.length} chars base64)`);
      const response = await visionClassify(gridBase64, prompt);
      _dbg(`visionClassify returned (${response.length} chars)`);
      results.push(`Vision: ${response.split('\n').filter(l => l.trim()).join(' | ')}`);

      const lines = response.split('\n');
      let answerLine = '';
      for (let i = lines.length - 1; i >= 0; i--) {
        if (/^\s*answer\s*:/i.test(lines[i].trim())) {
          answerLine = lines[i];
          break;
        }
      }

      const answerIndices: number[] = [];
      if (answerLine && !/none/i.test(answerLine.replace(/answer\s*:/i, ''))) {
        const nums = answerLine.match(/\d+/g);
        if (nums) {
          for (const n of nums) {
            let idx = parseInt(n);
            if (idx >= 0 && idx < actualTileCount) answerIndices.push(idx);
          }
        }
      }

      const analysisIndices: number[] = [];
      const fullText = response.replace(/\n/g, ' ');
      const tilePattern = /Tile\s+(\d+)\s*:\s*\[?\s*(yes|no)\b/gi;
      let m;
      while ((m = tilePattern.exec(fullText)) !== null) {
        const tidx = parseInt(m[1]);
        if (m[2].toLowerCase() === 'yes' && tidx >= 0 && tidx < actualTileCount) analysisIndices.push(tidx);
      }

      if (answerIndices.length > 0 && answerIndices.length >= analysisIndices.length) {
        matchedIndices.push(...answerIndices);
      } else if (analysisIndices.length > 0) {
        matchedIndices.push(...analysisIndices);
        if (answerLine && answerIndices.length > 0 && answerIndices.length < analysisIndices.length) {
          _dbg(`Answer line truncated (${answerIndices.length} vs ${analysisIndices.length} from analysis) — using analysis`);
        }
      }

      if (matchedIndices.length === 0) {
          for (const line of lines) {
            const ynMatch = line.match(/Tile\s+(\d+)\s*:.*?-\s*(YES|NO)/i);
            if (ynMatch) {
              const tidx = parseInt(ynMatch[1]);
              if (ynMatch[2].toUpperCase() === 'YES' && tidx >= 0 && tidx < actualTileCount) matchedIndices.push(tidx);
              continue;
            }
          const tileMention = line.match(/\*{1,2}(?:Tile|Cell)\s+(\d+)\*{1,2}|(?:tile|cell)\s+(\d+)\s*[:)]/i);
          if (tileMention) {
            const tidx = parseInt(tileMention[1] || tileMention[2]);
            if (tidx >= 0 && tidx < actualTileCount) {
              const lower = line.toLowerCase();
              const isPositive = /\b(contains?|shows?|has|includes?|visible|present|yes)\b/i.test(lower);
              const isNegative = /\b(no|none|not|empty|clear|does not|doesn't|without)\b/i.test(lower);
              if (isPositive && !isNegative) matchedIndices.push(tidx);
            }
          }
        }
      }

      if (matchedIndices.length === 0) {
        const lastLine = lines[lines.length - 1]?.trim() || '';
        if (/^[\d\s,\-]+$/.test(lastLine)) {
          const nums = lastLine.match(/\d+/g);
          if (nums) {
            for (const n of nums) {
              let idx = parseInt(n);
              if (idx >= 0 && idx < actualTileCount) matchedIndices.push(idx);
            }
          }
        }
      }

      const uniqueIndices = [...new Set(matchedIndices)];
      matchedIndices.length = 0;
      matchedIndices.push(...uniqueIndices);

      const selectRatio = matchedIndices.length / actualTileCount;
      if (selectRatio > 0.55 && actualTileCount >= 9) {
        _dbg(`over-classification detected: ${matchedIndices.length}/${actualTileCount} (${(selectRatio * 100).toFixed(0)}%) — re-prompting with stricter criteria`);
        matchedIndices.length = 0;

        const strictPrompt = `Look at this reCAPTCHA grid (${gridSize}, ${actualTileCount} tiles).

I asked for "${objectName}" and got too many matches. Please re-evaluate VERY carefully.

For "${objectName}" (${objDesc}):
- Only YES if you can CLEARLY see the object itself (not just the general scene/road/building)
- Most tiles will be NO. Typical answer: 2-5 tiles out of ${actualTileCount}.
- Go tile by tile. For each tile, ask: "Is there a ${objectName} IN this specific tile?"
- Supporting structures COUNT: poles/housings for traffic lights, etc.
- DO NOT write long reasoning. Keep each note to 3 words maximum.

${tileLayout.trim()}

Respond EXACTLY in this format — no extra text:
Analysis: Tile 0: [YES/NO - 3 words], Tile 1: [YES/NO - 3 words], ..., Tile ${actualTileCount - 1}: [YES/NO - 3 words]
Answer: [comma-separated numbers, or "none"]`;

        const strictResponse = await visionClassify(gridBase64, strictPrompt);
        _dbg(`strict vision returned (${strictResponse.length} chars)`);
        const strictLines = strictResponse.split('\n');
        let strictAnswer = '';
        for (let i = strictLines.length - 1; i >= 0; i--) {
          if (/^\s*answer\s*:/i.test(strictLines[i].trim())) { strictAnswer = strictLines[i]; break; }
        }
        if (strictAnswer && !/none/i.test(strictAnswer.replace(/answer\s*:/i, ''))) {
          const nums = strictAnswer.match(/\d+/g);
          if (nums) {
            for (const n of nums) {
              const idx = parseInt(n);
              if (idx >= 0 && idx < actualTileCount) matchedIndices.push(idx);
            }
          }
        }
        const strictUnique = [...new Set(matchedIndices)];
        matchedIndices.length = 0;
        matchedIndices.push(...strictUnique);
        _dbg(`strict matched indices: [${matchedIndices.join(',')}]`);
      }

      // Self-verification pass: ask model to confirm its answer
      if (matchedIndices.length > 0 && matchedIndices.length <= actualTileCount * 0.55) {
        _dbg(`running self-verification pass (initial: [${matchedIndices.join(',')}])...`);
        const selectedStr = matchedIndices.join(', ');
        const unselectedIndices = [];
        for (let i = 0; i < actualTileCount; i++) {
          if (!matchedIndices.includes(i)) unselectedIndices.push(i);
        }
        const unselectedStr = unselectedIndices.join(', ');

        const verifyPrompt = `You previously analyzed this reCAPTCHA grid (${gridSize}, ${actualTileCount} tiles) looking for "${objectName}" (${objDesc}).

Your answer was: tiles [${selectedStr}]
Tiles you said NO to: [${unselectedStr}]

Please VERIFY your answer:
1. For each tile you selected [${selectedStr}]: Is there DEFINITELY ${objectName} in it? If any tile is uncertain, remove it.
2. For each tile you rejected [${unselectedStr}]: Did you MISS any? Look carefully at each one.
3. Supporting structures COUNT: poles/housings for traffic lights, frames/wheels for bicycles, etc.

Keep notes to 3 words max per tile.

${tileLayout.trim()}

Respond EXACTLY:
Verify YES: [confirmed tiles] | Verify NO (remove): [tiles to remove] | Missed (add): [missed tiles]
Final: [comma-separated final tile numbers, or "none"]`;

        const verifyResponse = await visionClassify(gridBase64, verifyPrompt);
        _dbg(`verification returned (${verifyResponse.length} chars)`);

        // Parse verification result
        const verifyLines = verifyResponse.split('\n');
        let finalLine = '';
        for (let i = verifyLines.length - 1; i >= 0; i--) {
          if (/^\s*final\s*:/i.test(verifyLines[i].trim())) {
            finalLine = verifyLines[i];
            break;
          }
        }

        if (finalLine && !/none/i.test(finalLine.replace(/final\s*:/i, ''))) {
          const finalNums = finalLine.match(/\d+/g);
          if (finalNums) {
            const verifiedIndices: number[] = [];
            for (const n of finalNums) {
              const idx = parseInt(n);
              if (idx >= 0 && idx < actualTileCount) verifiedIndices.push(idx);
            }
            if (verifiedIndices.length > 0) {
              const before = `[${matchedIndices.join(',')}]`;
              matchedIndices.length = 0;
              matchedIndices.push(...new Set(verifiedIndices));
              _dbg(`verified: ${before} → [${matchedIndices.join(',')}]`);
            }
          }
        } else {
          // Try parsing from "Verify YES" / "Missed" / "Verify NO" lines
          const vText = verifyResponse.replace(/\n/g, ' ');
          const removeMatch = vText.match(/Verify\s+NO\s*(?:\(remove\))?\s*:\s*\[?\s*([\d,\s]+)/i);
          const missedMatch = vText.match(/Missed\s*(?:\(add\))?\s*:\s*\[?\s*([\d,\s]+)/i);

          if (removeMatch) {
            const removeNums = (removeMatch[1].match(/\d+/g) || []).map(Number);
            for (const r of removeNums) {
              const idx = matchedIndices.indexOf(r);
              if (idx >= 0) matchedIndices.splice(idx, 1);
            }
          }
          if (missedMatch) {
            const addNums = (missedMatch[1].match(/\d+/g) || []).map(Number);
            for (const a of addNums) {
              if (a >= 0 && a < actualTileCount && !matchedIndices.includes(a)) matchedIndices.push(a);
            }
          }
          if (removeMatch || missedMatch) {
            _dbg(`verification adjusted: [${matchedIndices.join(',')}]`);
          }
        }
      }

      if (matchedIndices.length > actualTileCount * 0.5 && actualTileCount >= 9) {
        _dbg(`post-verification over-select: ${matchedIndices.length}/${actualTileCount} — trimming to most confident`);
        const trimPrompt = `reCAPTCHA grid (${gridSize}, ${actualTileCount} tiles). Looking for "${objectName}" (${objDesc}).
Current selection: [${matchedIndices.join(', ')}] — this is TOO MANY (${matchedIndices.length} tiles).
Typical answer: 2-5 tiles. Pick ONLY the ${Math.min(5, Math.ceil(actualTileCount * 0.35))} MOST OBVIOUS tiles that CLEARLY show ${objectName}.
${tileLayout.trim()}
Respond with ONLY the tile numbers (comma-separated), nothing else:`;
        const trimResp = await visionClassify(gridBase64, trimPrompt);
        const trimNums = trimResp.match(/\d+/g);
        if (trimNums) {
          const trimmed: number[] = [];
          for (const n of trimNums) {
            const idx = parseInt(n);
            if (idx >= 0 && idx < actualTileCount && !trimmed.includes(idx)) trimmed.push(idx);
          }
          if (trimmed.length > 0 && trimmed.length <= actualTileCount * 0.45) {
            _dbg(`trimmed: [${matchedIndices.join(',')}] → [${trimmed.join(',')}]`);
            matchedIndices.length = 0;
            matchedIndices.push(...trimmed);
          }
        }
      }

      _dbg(`parsed matched indices: [${matchedIndices.join(',')}]`);

      // TEMP: CapTCHAi training — REMOVE AFTER TRAINING
      try {
        _dbg('calling CapTCHAi for ground truth...');
        const capthaiBuf = await sharp(gridScreenshotPath).resize(200, 200, { fit: 'inside' }).jpeg({ quality: 50 }).toBuffer();
        _dbg(`CapTCHAi image: ${capthaiBuf.length} bytes`);
        const capthaiB64 = capthaiBuf.toString('base64');
        const capthaiResult = await capthaiSolve(capthaiB64, objectName, gridSize);
        if (capthaiResult && capthaiResult.length > 0) {
          const visionSet = new Set(matchedIndices);
          const capthaiSet = new Set(capthaiResult);
          const correct = matchedIndices.length === capthaiResult.length &&
            matchedIndices.every(i => capthaiSet.has(i));
          saveCapthaiTraining({
            objectType: objectName,
            gridSize,
            capthaiIndices: capthaiResult,
            visionIndices: [...matchedIndices],
            correct,
            timestamp: Date.now(),
          });
          _dbg(`CapTCHAi ground truth: [${capthaiResult.join(',')}] vs vision [${matchedIndices.join(',')}] → ${correct ? 'CORRECT ✅' : 'WRONG ❌'}`);
          results.push(`CapTCHAi: [${capthaiResult.join(',')}] → ${correct ? '✅' : '❌'}`);
          if (!correct) {
            matchedIndices.length = 0;
            matchedIndices.push(...capthaiResult);
            _dbg(`using CapTCHAi answer: [${matchedIndices.join(',')}]`);
          }
        } else {
          _dbg('CapTCHAi returned no result');
        }
      } catch (e: any) {
        _dbg(`CapTCHAi training error: ${e.message}`);
      }
      // END TEMP: CapTCHAi training
    } catch (e: any) {
      _dbg(`visionClassify FAILED: ${e.message}`);
    }
  }

  _dbg(`matched [${matchedIndices.join(',')}]`);

  if (matchedIndices.length === 0) {
    const skipMentioned = /skip|none/i.test(instruction);
    if (skipMentioned) {
      _dbg('no matches found and instruction mentions skip — clicking skip button');
      try {
        const skipText = await frame.evaluate(() => {
          const btn = document.querySelector('#recaptcha-verify-button, .rc-button-submit') as HTMLElement;
          return btn ? btn.textContent || '' : '';
        });
        if (/skip/i.test(skipText)) {
          await frame.evaluate(() => {
            const btn = document.querySelector('#recaptcha-verify-button, .rc-button-submit') as HTMLElement;
            if (btn) btn.click();
          });
          await page.waitForTimeout(2000);
          _dbg('skip button clicked via JS');
          results.push('No matches found, clicked skip');
          return results.join('\n');
        }
      } catch (e: any) { _dbg(`skip button click failed: ${e.message}`); }
    }
    results.push('No matching tiles found, attempting verify anyway');
  }
  _dbg(`clicking ${matchedIndices.length} tiles`);

  const clickedSet = new Set<number>();
  for (const idx of matchedIndices) {
    try {
      if (idx >= actualTileCount || idx >= visibleTiles.length) continue;
      try {
        await frame.evaluate((tileIdx: number) => {
          const tds = document.querySelectorAll('table td');
          if (tds[tileIdx]) (tds[tileIdx] as HTMLElement).click();
        }, idx);
      } catch {
        await visibleTiles[idx].click({ force: true, timeout: 3000 });
      }
      clickedSet.add(idx);
      await page.waitForTimeout(300 + Math.random() * 400);
      _dbg(`clicked tile ${idx}`);
    } catch (e: any) {
      try {
        const refreshed = await findGridTiles(frame, provider);
        const refreshedVisible: any[] = [];
        for (const t of refreshed) { try { if (await t.isVisible()) refreshedVisible.push(t); } catch {} }
        if (idx < refreshedVisible.length) {
          try {
            await frame.evaluate((tileIdx: number) => {
              const tds = document.querySelectorAll('table td');
              if (tds[tileIdx]) (tds[tileIdx] as HTMLElement).click();
            }, idx);
          } catch {
            await refreshedVisible[idx].click({ force: true, timeout: 3000 });
          }
          clickedSet.add(idx);
          await page.waitForTimeout(100 + Math.random() * 100);
          _dbg(`clicked tile ${idx} (re-fetched)`);
        }
      } catch (e2: any) {
        _dbg(`FAILED to click tile ${idx}: ${e2.message}`);
      }
    }
  }

  // @ts-ignore — self-review disabled (was removing correct tiles and adding wrong ones)
  if (false && isRecaptcha && clickedSet.size > 0) {
    _dbg('self-review: checking selections...');
    await page.waitForTimeout(300);
    try {
      const reviewPath = join(homedir(), '.aurix-captcha-review.png');
      let reviewShot = false;
      try { await frame.locator('body').screenshot({ path: reviewPath, timeout: 5000 }); reviewShot = true; } catch {}
      if (!reviewShot) { try { await page.screenshot({ path: reviewPath }); reviewShot = true; } catch {} }
      if (reviewShot) {
        const selectedList = [...clickedSet].sort((a, b) => a - b).join(', ');
        const reviewPrompt = `This is a reCAPTCHA grid. Tiles ${selectedList} are selected (checkmarked). Task: "${objectName}"\n\nCheck if any selected tiles DON'T contain ${objectName} (wrong), or if any unselected tiles DO contain ${objectName} (missed).\n\nRespond with ONLY ONE of these exact formats (no explanation):\nAdd: [tile numbers]\nRemove: [tile numbers]\nCorrect`;
        const reviewBase64 = readFileBase64(reviewPath);
        const reviewResponse = await visionClassify(reviewBase64, reviewPrompt);
        _dbg(`self-review response: ${reviewResponse.split('\n').pop()?.trim()}`);
        const addMatch: any = reviewResponse.match(/(?:add|also select|missed|need)[:\s]+\[?([\d,\s]+)\]?/i);
        const removeMatch: any = reviewResponse.match(/(?:remove|deselect|unselect|wrong|incorrect)[:\s]+\[?([\d,\s]+)\]?/i);
        _dbg(`self-review addMatch: ${addMatch ? 'yes' : 'no'}, removeMatch: ${removeMatch ? 'yes' : 'no'}`);
      }
    } catch (e: any) { _dbg(`self-review failed: ${e.message}`); }
  }

  // @ts-ignore — dynamic tile analysis disabled
  if (false && isRecaptcha && is3x3 && clickedSet.size > 0) {
    _dbg('dynamic tile analysis disabled');
  }

  if (isRecaptcha && clickedSet.size > 0) {
    await page.waitForTimeout(1500 + Math.random() * 1000);
  }

  _dbg('clicking verify button...');
  try {
    const verifyClicked = await frame.evaluate(() => {
      const btn = document.querySelector('#recaptcha-verify-button, .rc-button-submit, .button-submit, [id*="verify"]') as HTMLElement;
      if (!btn) return false;
      btn.click();
      return true;
    });

    if (!verifyClicked) {
      let verifyBtn = frame.locator('#recaptcha-verify-button, .rc-button-submit, .button-submit, [id*="verify"]');
      if (await verifyBtn.count() === 0) {
        verifyBtn = frame.locator('button:has-text("Verify"), button:has-text("Next"), button:has-text("Submit")');
      }
      if (await verifyBtn.count() > 0) {
        await verifyBtn.first().click({ force: true, timeout: 5000 });
      }
    }

    _dbg('verify button clicked, waiting for result...');
    await page.waitForTimeout(3000);

    let hasToken = false;
    try {
      hasToken = await page.evaluate(() => {
        const el = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement;
        return !!(el && el.value && el.value.length > 10);
      });
    } catch {}

    let ariaChecked = false;
    try {
      for (const f of page.frames()) {
        if (f.url().includes('/recaptcha/') && f.url().includes('/anchor')) {
          const anchor = f.locator('#recaptcha-anchor[aria-checked="true"]');
          if (await anchor.count() > 0) { ariaChecked = true; break; }
        }
      }
    } catch {}

    if (hasToken || ariaChecked) {
      const verifyResultPath = join(homedir(), '.aurix-captcha-verify-result.png');
      await page.screenshot({ path: verifyResultPath }).catch(() => {});
      saveCaptchaTraining({ instruction: cleanInstruction, objectType: objectName, gridSize, gridCount: actualTileCount, tileCount: actualTileCount, matchedIndices: [...matchedIndices], timestamp: Date.now() });
      _dbg(`CAPTCHA SOLVED! (token=${hasToken}, aria=${ariaChecked})`);
      results.push(`[OK] CAPTCHA SOLVED! ✅`);
      results.push(`→ The form can now be submitted. Click the submit/register button to continue.`);
      return results.join('\n');
    }

    const currentFrames = page.frames();
    const stillHasBframe = currentFrames.some((f: any) => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
    if (!stillHasBframe) {
      const verifyResultPath = join(homedir(), '.aurix-captcha-verify-result.png');
      await page.screenshot({ path: verifyResultPath }).catch(() => {});
      saveCaptchaTraining({ instruction: cleanInstruction, objectType: objectName, gridSize, gridCount: actualTileCount, tileCount: actualTileCount, matchedIndices: [...matchedIndices], timestamp: Date.now() });
      _dbg('CAPTCHA SOLVED (bframe disappeared)');
      results.push(`[OK] CAPTCHA SOLVED! ✅`);
      results.push(`→ The form can now be submitted. Click the submit/register button to continue.`);
      return results.join('\n');
    }

    const errorEl = frame.locator('.rc-imageselect-incorrect-response, .error-message, .incorrect').first();
    const errorVisible = await errorEl.count() > 0 && await errorEl.isVisible().catch(() => false);
    if (errorVisible) {
      _dbg('verification FAILED - error shown');
      results.push('Verification failed, challenge will retry');
      return results.join('\n');
    }

    const newChallenge = await frame.locator('.rc-imageselect-instructions, .prompt-text').count();
    if (newChallenge > 0) {
      const newInstr = (await frame.locator('.rc-imageselect-instructions, .prompt-text').first().textContent() || '').trim();
      if (newInstr !== instruction) {
        _dbg(`new challenge appeared: "${newInstr}"`);
        saveCaptchaTraining({ instruction: cleanInstruction, objectType: objectName, gridSize, gridCount: actualTileCount, tileCount: actualTileCount, matchedIndices: [...matchedIndices], visionResponse: results.join('\n').slice(0, 500), timestamp: Date.now() });
        results.push(`New challenge appeared: "${newInstr}"`);
        return results.join('\n');
      }
      _dbg('same challenge still present after verify');
      results.push('Same challenge still present');
      return results.join('\n');
    }

    if (matchedIndices.length === 0) {
      _dbg('verification uncertain — 0 tiles were selected, likely not solved');
      results.push('Verification uncertain — no tiles were selected');
      return results.join('\n');
    }

    const verifyResultPath = join(homedir(), '.aurix-captcha-verify-result.png');
    await page.screenshot({ path: verifyResultPath }).catch(() => {});
    saveCaptchaTraining({ instruction: cleanInstruction, objectType: objectName, gridSize, gridCount: actualTileCount, tileCount: actualTileCount, matchedIndices: [...matchedIndices], timestamp: Date.now() });
    _dbg('CAPTCHA SOLVED (no error, no challenge)');
    results.push(`[OK] CAPTCHA SOLVED! ✅`);
    results.push(`→ The form can now be submitted. Click the submit/register button to continue.`);
    return results.join('\n');
  } catch (e: any) {
    _dbg(`Verify FAILED: ${e.message}`);
    results.push(`Verify failed: ${e.message}`);
    return results.join('\n');
  }
}
