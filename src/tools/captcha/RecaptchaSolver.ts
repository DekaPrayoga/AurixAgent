import { homedir } from 'os';
import { join } from 'path';
import { readdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, existsSync } from 'fs';
import sharp from 'sharp';
import { visionClassify, readFileBase64, findGridTiles, analyzeTileCrops, getTrainingHint, getCapthaiCorrectionHint, capthaiSolve, saveCapthaiTraining, saveCaptchaResult, CaptchaResult, humanMove, humanClickAt, warmupBehavior, TRAINING_DIR } from './common.js';
import { checkAudioButton, solveAudioCaptcha } from './AudioBypass.js';
import { loadConfig } from '../../agent/Config.js';

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

  const sessionLog: {
    tileDescriptions: { idx: number; description: string; selected: boolean }[];
    directResult: number[];
    perTileResult: number[];
    gridLevelResult: number[];
    verifyResults: { idx: number; kept: boolean; description: string }[];
    mergeInfo: string;
    verifyResult: string;
  } = {
    tileDescriptions: [],
    directResult: [],
    perTileResult: [],
    gridLevelResult: [],
    verifyResults: [],
    mergeInfo: '',
    verifyResult: '',
  };

  let _saved = false;
  const _save = (verifyResult: string) => {
    if (_saved) return;
    _saved = true;
    sessionLog.verifyResult = verifyResult;
    try {
      const objMatch = instruction.match(/(?:with|of|containing)\s+(.+?)(?:\.|Click|If\s|Verify|$)/i);
      const objectType = objMatch ? objMatch[1].trim() : '';
      const isPass = /\[VERIFIED\]|\[BFRAME_GONE\]/.test(results.join('\n'));
      const isNewChallenge = /\[NEW_CHALLENGE\]/.test(results.join('\n'));
      const result: CaptchaResult = {
        instruction: instruction.substring(0, 120),
        objectType,
        gridSize: `${gridRows}x${gridCols}`,
        tileCount: actualTileCount,
        matchedIndices: [...matchedIndices],
        result: isPass ? 'verified' : isNewChallenge ? 'new_challenge' : /FAIL/.test(verifyResult) ? 'fail' : 'pass',
        timestamp: Date.now(),
        source: provider,
        tileDescriptions: sessionLog.tileDescriptions.map(t => ({
          idx: t.idx,
          description: t.description,
          selected: matchedIndices.includes(t.idx),
        })),
        gridAnalysis: sessionLog.gridLevelResult.length > 0 ? { result: sessionLog.gridLevelResult } : undefined,
        perTileAnalysis: sessionLog.perTileResult.length > 0 ? { result: sessionLog.perTileResult } : undefined,
        directAnalysis: sessionLog.directResult.length > 0 ? { result: sessionLog.directResult } : undefined,
        verifyResults: sessionLog.verifyResults.length > 0 ? sessionLog.verifyResults : undefined,
        mergeInfo: sessionLog.mergeInfo || undefined,
        gridImagePath: gridScreenshotPath,
        is3x3Flip,
        errorNotes: verifyResult,
      };
      saveCaptchaResult(result);
    } catch (e: any) {
      _dbg(`save failed: ${e.message}`);
    }
  };

  // === Check captcha audio config ===
  const config = loadConfig();
  const captchaAudio = config.captchaAudio;

  // Known vision-capable models
  const VISION_MODELS = [
    'gpt-4o', 'gpt-4o-mini', 'gpt-4-vision', 'gpt-4-turbo',
    'claude-sonnet-4', 'claude-opus-4', 'claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku',
    'gemini', 'gemini-pro', 'gemini-flash', 'gemini-1.5', 'gemini-2', 'gemini-3',
  ];

  const visionModel = (config.visionModel || config.model || '').toLowerCase();
  const isVisionModel = VISION_MODELS.some(vm => visionModel.includes(vm));

  let audioFirst = captchaAudio === 'audio' || captchaAudio === true;
  let audioFallback = captchaAudio === 'hybrid' || captchaAudio === 'audio' || captchaAudio === true;

  // Auto-switch to audio if model doesn't support vision
  if (!isVisionModel && (captchaAudio === 'hybrid' || captchaAudio === 'image' || !captchaAudio)) {
    _dbg(`WARNING: Model "${visionModel}" is not a vision model. Auto-switching to audio captcha mode.`);
    _dbg(`Please set up Groq API key (get free key at https://console.groq.com/docs/speech-to-text) or install local Whisper.`);
    _dbg(`Set groqApiKey in config.yaml or run: pip install openai-whisper`);
    audioFirst = true;
    audioFallback = true;
  }

  if (audioFirst) {
    try {
      const hasAudio = await checkAudioButton(frame);
      if (hasAudio) {
        _dbg('Audio-first mode: trying audio bypass...');
        const audioResult = await solveAudioCaptcha(page, frame);
        if (audioResult.success) {
          _dbg(`AUDIO BYPASS SUCCESS! Transcription: "${audioResult.transcription}"`);
          results.push(`[VERIFIED] audio bypass: "${audioResult.transcription}"`);
          return results.join('\n');
        } else {
          _dbg(`Audio bypass failed${audioResult.transcription ? ` (transcription: "${audioResult.transcription}")` : ''} — falling back to image solver`);
        }
      } else {
        _dbg('No audio button found in audio-first mode — falling back to image solver');
      }
    } catch (e: any) {
      _dbg(`Audio-first error: ${e.message} — falling back to image solver`);
    }
  }

  let instruction = '';
  try {
    await page.waitForTimeout(1500);
    _dbg(`frame url: ${frame.url().substring(0, 120)}`);

    for (let waitRetry = 0; waitRetry < 3; waitRetry++) {
      try { await frame.locator('.rc-imageselect-instructions, .prompt-text, .prompt-text-h').first().waitFor({ state: 'visible', timeout: 5000 }); break; } catch {
        if (waitRetry < 2) { _dbg(`waiting for challenge render (retry ${waitRetry + 1})...`); await page.waitForTimeout(1000); }
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
    _save('NO_INSTRUCTION');
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
  const is3x3Flip = is3x3 && /verify once there are none left/i.test(instruction);
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
  let domTileBufs: { idx: number; buf: Buffer }[] = [];
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

      const results: string[] = [];
      const cols = cells.length <= 9 ? 3 : 4;
      const rows = Math.ceil(cells.length / cols);
      const debugInfo: any[] = [];

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const img = cell.querySelector('img') as HTMLImageElement | null;
        if (img && img.complete && img.naturalWidth > 0) {
          const cs = getComputedStyle(img);
          const wrapper = cell.querySelector('.rc-image-tile-wrapper') as HTMLElement;
          const wcs = wrapper ? getComputedStyle(wrapper) : null;
          const wW = wrapper ? parseInt(wcs!.width) || 95 : 95;
          const wH = wrapper ? parseInt(wcs!.height) || 95 : 95;
          const isSpriteTile = img.naturalWidth > wW * 1.5;

          if (isSpriteTile) {
            try {

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
        domTileBufs = tileBufs.map(tb => ({ ...tb }));
        // DEBUG: save raw tiles to disk for inspection
        for (const { idx, buf } of tileBufs.slice(0, 9)) {
          try { writeFileSync(join(homedir(), `.aurix-raw-tile-${idx}.png`), buf); } catch {}
        }
        try {
          const meta0 = await sharp(tileBufs[0].buf).metadata();
          const rawW = meta0.width || 100, rawH = meta0.height || 100;
          const MIN_TILE = 500;
          const tw = rawW < MIN_TILE ? MIN_TILE : rawW;
          const th = rawH < MIN_TILE ? MIN_TILE : rawH;
          const gridW = tw * gridCols, gridH = th * gridRows;
          const composites: any[] = [];
          for (const { idx, buf } of tileBufs) {
            const r = Math.floor(idx / gridCols), c = idx % gridCols;
            const tileBuf = (rawW < MIN_TILE || rawH < MIN_TILE)
              ? await sharp(buf).resize(tw, th, { kernel: sharp.kernel.lanczos3 }).png().toBuffer()
              : buf;
            composites.push({ input: tileBuf, left: c * tw, top: r * th });
          }
          const composedBuf = await sharp({ create: { width: gridW, height: gridH, channels: 3, background: { r: 200, g: 200, b: 200 } } })
            .composite(composites).png().toBuffer();
          await sharp(composedBuf).toFile(gridScreenshotPath);
          const stats = await sharp(composedBuf).stats();
          const meanAll = stats.channels.reduce((s: number, c: any) => s + c.mean, 0) / stats.channels.length;
          if (composedBuf.length > 5000 && meanAll < 250) {
            gridShot = true;
            gridShotFromTable = true;
            _dbg(`composed grid from DOM: ${gridW}x${gridH} (tiles ${rawW}x${rawH}→${tw}x${th}, buf=${composedBuf.length}, mean=${meanAll.toFixed(1)})`);
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
    // ============================================
    // # DONT CHANGE ANYTHING HERE - 3x3 FLIP SOLVER
    // This section handles 3x3 flip captcha challenges.
    // It's working correctly (100% pass rate). Do not modify.
    // ============================================
    // For 3x3 flip: use sprite tiles + grid crops + grid-level = triple analysis
    if (is3x3Flip) {
      let directResult: number[] = [];
      // Direct sprite: ALL tiles in ONE API call (fast ~5s)
      if (domTileBufs.length >= actualTileCount) {
        try {
          _dbg('3x3 flip: running direct sprite analysis (single batch)...');
          const cols = gridCols, rows = gridRows;
          const ts = 200;
          const gW = cols * ts, gH = rows * ts;
          const composites: any[] = [];
          for (const { idx, buf } of domTileBufs) {
            const r = Math.floor(idx / cols), c = idx % cols;
            const resized = await sharp(buf).resize(ts, ts, { fit: 'cover', kernel: sharp.kernel.lanczos3 }).sharpen({ sigma: 1.5 }).modulate({ brightness: 1.05, saturation: 1.3 }).png().toBuffer();
            composites.push({ input: resized, left: c * ts, top: r * ts });
          }
          const spriteGrid = await sharp({ create: { width: gW, height: gH, channels: 3, background: { r: 200, g: 200, b: 200 } } }).composite(composites).png().toBuffer();
          const tileLayout = Array.from({ length: rows }, (_, r) => {
            const tiles = Array.from({ length: cols }, (_, c) => `[${r * cols + c}]`);
            return `Row ${r + 1}: ${tiles.join(' ')}`;
          }).join('\n');
          const prompt = `3x3 grid of tiles. Find ALL tiles containing "${objectName}".
${tileLayout}
YES if you can clearly identify ${objectName}. NO if unsure.
[N]: YES/NO
Answer: {"yes": [numbers]}`;
          const resp = await visionClassify(spriteGrid.toString('base64'), prompt);
          const tileYes: number[] = [];
          for (let rawLine of resp.split('\n')) {
            const line = rawLine.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim();
            const m1 = line.match(/^\[(\d+)\]:\s*(.+?)\s*→\s*(YES|NO)/i);
            const m2 = line.match(/^\[(\d+)\]:\s*(YES|NO)/i);
            if (m1) { const ti = parseInt(m1[1]); if (m1[3].toUpperCase() === 'YES' && ti < actualTileCount) tileYes.push(ti); }
            else if (m2) { const ti = parseInt(m2[1]); if (m2[2].toUpperCase() === 'YES' && ti < actualTileCount) tileYes.push(ti); }
          }
          try {
            const jm = resp.match(/\{[^{}]*"yes"\s*:\s*\[[^\]]*\][^{}]*\}/);
            if (jm) { const p = JSON.parse(jm[0]); if (Array.isArray(p.yes)) for (const n of p.yes) { const num = parseInt(n); if (!isNaN(num) && num < actualTileCount) directResult.push(num); } }
          } catch {}
          if (directResult.length === 0 && tileYes.length > 0) directResult = tileYes;
          directResult = [...new Set(directResult)];
          _dbg(`3x3 flip direct sprite result: [${directResult.join(',')}]`);
          sessionLog.directResult = [...directResult];
        } catch (e: any) {
          _dbg(`direct sprite analysis failed: ${e.message}`);
        }
      }

      // Per-tile removed for speed — using direct sprite + grid-level only
      let perTileResult: number[] = [];

      // Only use per-tile if not over-classified
      if (perTileResult.length > Math.ceil(actualTileCount * 0.78)) {
        _dbg(`per-tile over-classified: ${perTileResult.length}/${actualTileCount} — will use grid-level only`);
        perTileResult = [];
      }

      // Also run grid-level analysis for cross-checking
      let gridLevelResult: number[] = [];
      try {
        _dbg('3x3 flip: running grid-level analysis for cross-check...');
        const tileLayout = Array.from({ length: gridRows }, (_, r) => {
          const tiles = Array.from({ length: gridCols }, (_, c) => {
            const idx = r * gridCols + c;
            return idx < actualTileCount ? `[${idx}]` : '';
          });
          return `Row ${r + 1} (left to right): ${tiles.join(' ')}`;
        }).join('\n');

        const objLower = objectName.toLowerCase();
        const objectHints: Record<string, string> = {
          bus: 'Buses have: large rectangular body, ROW of passenger windows, destination sign on front/top, much taller than cars. Do NOT select vans, box trucks, or RVs.',
          car: 'Cars: standard passenger vehicles with 4 wheels, windshield, typical car shape. Do NOT select buses, trucks, motorcycles, or bicycles.',
          motorcycle: 'Motorcycles have: 2 wheels, visible engine/exhaust, gas tank. INCLUDE scooters and mopeds. Do NOT select cars (4 wheels, enclosed body) or bicycles (no engine).',
          bicycle: 'Bicycles have: 2 thin wheels, thin frame, handlebars, NO engine. Do NOT select motorcycles (have engine/gas tank) or scooters.',
          traffic_light: 'Traffic lights have: 2-3 colored lights (red/yellow/green) stacked vertically on a pole. Do NOT select street lamps (single white light).',
          fire_hydrant: 'Fire hydrants: SHORT barrel shape on ground/sidewalk, dome cap, 2-3 side nozzles, bright red/yellow/orange. Do NOT select mailboxes, trash cans, or bollards.',
          crosswalk: 'Crosswalks: WIDE white zebra stripes (parallel bars) painted on road/ground. Must see the stripe PATTERN clearly. Do NOT select streets with cars, alleys, intersections without zebra stripes, lane markings, or regular road lines.',
          stairs: 'Stairs: visible steps with risers and treads. Do NOT select ramps or sloped surfaces.',
          tractor: 'Tractors: large farm vehicle with big rear wheels, small front wheels, exhaust pipe, cab. INCLUDE all types of tractors.',
        };
        let specificHint = '';
        for (const [key, hint] of Object.entries(objectHints)) {
          if (objLower.includes(key) || objLower.includes(key.replace('_', ' '))) { specificHint = hint; break; }
        }

        const gridPrompt = `${gridShotFromTable ? 'The image shows a grid of tiles. Each cell is one tile.' : 'The image shows a captcha frame. The tile grid is the main content.'}
Grid: ${gridSize} (${actualTileCount} tiles)
${tileLayout}

Find ALL tiles containing "${objectName}".
Scan each tile carefully — the ${objectName} may be small, partially visible, or in the background.
YES if you can clearly identify ${objectName} in the tile.
NO if the tile shows roads, sky, buildings, or other objects without ${objectName}.
When unsure, say NO.
${specificHint ? `- ${specificHint}\n` : ''}[N]: YES/NO
Answer: {"yes": [numbers]}`;

        let gridBase64: string;
        try {
          if (is3x3Flip && domTileBufs.length >= actualTileCount) {
            // 3x3 flip: compose cleaner grid at 200px per tile (2x upscale)
            const tileSize = 200;
            const gW = tileSize * gridCols, gH = tileSize * gridRows;
            const comps: any[] = [];
            for (const { idx, buf } of domTileBufs) {
              const r = Math.floor(idx / gridCols), c = idx % gridCols;
              const resized = await sharp(buf).resize(tileSize, tileSize, { kernel: sharp.kernel.lanczos3 }).sharpen({ sigma: 1.0 }).png().toBuffer();
              comps.push({ input: resized, left: c * tileSize, top: r * tileSize });
            }
            const cleanGrid = await sharp({ create: { width: gW, height: gH, channels: 3, background: { r: 200, g: 200, b: 200 } } }).composite(comps).png().toBuffer();
            gridBase64 = cleanGrid.toString('base64');
          } else {
            const cleanBuf = await sharp(gridScreenshotPath)
              .resize(1200, 1200, { fit: 'inside' })
              .normalize()
                            .sharpen({ sigma: 1.5, m1: 0.5, m2: 0.8 })
              .modulate({ brightness: 1.1, saturation: 1.4 })
              .png().toBuffer();
            gridBase64 = cleanBuf.toString('base64');
          }
        } catch {
          gridBase64 = readFileBase64(gridScreenshotPath);
        }

        const gridResponse = await visionClassify(gridBase64, gridPrompt);
        _dbg(`grid-level response (${gridResponse.length} chars)`);

        const tileYes: number[] = [];
        for (let rawLine of gridResponse.split('\n')) {
          const line = rawLine.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim();
          const m1 = line.match(/^\[(\d+)\]:\s*(.+?)\s*→\s*(YES|NO)/i);
          const m2 = line.match(/^\[(\d+)\]:\s*(YES|NO)/i);
          if (m1) {
            const tileIdx = parseInt(m1[1]);
            if (m1[3].toUpperCase() === 'YES' && tileIdx >= 0 && tileIdx < actualTileCount) tileYes.push(tileIdx);
          } else if (m2) {
            const tileIdx = parseInt(m2[1]);
            if (m2[2].toUpperCase() === 'YES' && tileIdx >= 0 && tileIdx < actualTileCount) tileYes.push(tileIdx);
          }
        }

        try {
          const jsonMatch = gridResponse.match(/\{[^{}]*"yes"\s*:\s*\[[^\]]*\][^{}]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed.yes)) {
              for (const n of parsed.yes) {
                const num = parseInt(n);
                if (!isNaN(num) && num >= 0 && num < actualTileCount) gridLevelResult.push(num);
              }
            }
          }
        } catch {}

        if (gridLevelResult.length === 0 && tileYes.length > 0) {
          gridLevelResult = tileYes;
        }
        gridLevelResult = [...new Set(gridLevelResult)];
        _dbg(`3x3 flip grid-level result: [${gridLevelResult.join(',')}]`);
        sessionLog.gridLevelResult = [...gridLevelResult];
      } catch (e: any) {
        _dbg(`grid-level analysis failed: ${e.message}`);
      }

      // Merge: UNION of direct sprite + grid-level (include all matches)
      // Multi-round flip will handle any extra tiles across rounds
      const merged = new Set([...directResult, ...gridLevelResult]);
      matchedIndices.push(...merged);
      _dbg(`3x3 flip merged: direct=[${directResult.join(',')}] grid=[${gridLevelResult.join(',')}] → union=[${matchedIndices.join(',')}]`);
      sessionLog.mergeInfo = `direct=[${directResult.join(',')}] per-tile=[${perTileResult.join(',')}] grid=[${gridLevelResult.join(',')}] → [${matchedIndices.join(',')}]`;
    }

    // For 4x4 and static 3x3: grid-level PRIMARY (more reliable than per-tile)
    if (matchedIndices.length === 0) {
    try {
      let tileLayout = '';
      let idx = 0;
      for (let r = 0; r < gridRows; r++) {
        const rowTiles: string[] = [];
        for (let c = 0; c < gridCols; c++) {
          if (idx < actualTileCount) rowTiles.push(`[${idx}]`);
          idx++;
        }
        tileLayout += `Row ${r + 1} (from left to right): ${rowTiles.join(' ')}\n`;
      }

      const sourceNote = gridShotFromTable
        ? 'The image shows a grid of tiles. Each cell is one tile.'
        : 'The image shows a captcha frame. The tile grid is the main content.';

      const objLower = objectName.toLowerCase();
      const objectHints: Record<string, string> = {
        bus: 'Buses have: large rectangular body, ROW of passenger windows, destination sign on front/top, much taller than cars. Do NOT select fire hydrants (small barrel on ground), vans, box trucks, or RVs.',
        car: 'Cars: standard passenger vehicles with 4 wheels, windshield, typical car shape. Do NOT select buses, trucks, motorcycles, or bicycles.',
        motorcycle: 'Motorcycles have: 2 wheels, visible engine/exhaust, gas tank. INCLUDE scooters and mopeds. Do NOT select cars (4 wheels, enclosed body) or bicycles (no engine).',
        bicycle: 'Bicycles have: 2 thin wheels, thin frame, handlebars, NO engine. Do NOT select motorcycles (have engine/gas tank) or scooters.',
        traffic_light: 'Traffic lights have: 2-3 colored lights (red/yellow/green) stacked vertically on a pole. Do NOT select street lamps (single white light).',
        fire_hydrant: 'Fire hydrants: SHORT barrel shape on ground, dome cap, 2-3 side nozzles, bright red/yellow/orange. They are SMALL objects. Do NOT select buses, vehicles, mailboxes, or bollards.',
        crosswalk: 'Crosswalks: WIDE white zebra stripes (parallel bars) painted on road/ground. Must see the stripe PATTERN clearly. Do NOT select streets with cars, alleys, intersections without zebra stripes, lane markings, or regular road lines.',
        stairs: 'Stairs: visible steps with risers and treads. Do NOT select ramps or sloped surfaces.',
      };
      let specificHint = '';
      for (const [key, hint] of Object.entries(objectHints)) {
        if (objLower.includes(key) || objLower.includes(key.replace('_', ' '))) { specificHint = hint; break; }
      }

      const prompt = is3x3Flip
        ? `${sourceNote}
Grid: ${gridSize} (${actualTileCount} tiles)
${tileLayout.trim()}

Find ALL tiles containing "${objectName}".
YES if you can clearly identify ${objectName}. NO if unsure.
${specificHint ? `- ${specificHint}\n` : ''}[N]: YES/NO
Answer: {"yes": [numbers]}`
        : `${sourceNote}
Grid: ${gridSize} (${actualTileCount} tiles)
${tileLayout.trim()}

Find ALL tiles containing "${objectName}".
Check EVERY tile one by one. Do NOT skip any tile.
${objectName} may be small or partially visible in a tile.
YES if any part of ${objectName} is visible. NO if not.
${specificHint ? `- ${specificHint}\n` : ''}[N]: YES/NO
Answer: {"yes": [numbers]}`;

      _dbg('calling visionClassify with per-tile analysis...');
      let gridBase64: string;
      try {
        const cleanBuf = await sharp(gridScreenshotPath)
          .resize(1200, 1200, { fit: 'inside' })
          .normalize()
                    .sharpen({ sigma: 1.5, m1: 0.5, m2: 0.8 })
          .modulate({ brightness: 1.1, saturation: 1.4 })
          .png().toBuffer();
        gridBase64 = cleanBuf.toString('base64');
        _dbg(`grid image ${cleanBuf.length} bytes base64`);
      } catch {
        gridBase64 = readFileBase64(gridScreenshotPath);
      }

      const response = await visionClassify(gridBase64, prompt);
      _dbg(`vision response (${response.length} chars)`);
      const lastLines = response.trim().split('\n').slice(-3).join(' | ');
      _dbg(`response tail: ${lastLines.substring(0, 200)}`);

      const tileYes: number[] = [];
      for (let rawLine of response.split('\n')) {
        const line = rawLine.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim();
        const m1 = line.match(/^\[(\d+)\]:\s*(.+?)\s*→\s*(YES|NO)/i);
        const m2 = line.match(/^\[(\d+)\]:\s*(YES|NO)/i);
        if (m1) {
          const tileIdx = parseInt(m1![1]);
          const answer = m1![3].toUpperCase();
          _dbg(`tile ${tileIdx} → ${answer} (${m1![2].substring(0, 60)})`);
          if (answer === 'YES' && tileIdx >= 0 && tileIdx < actualTileCount) tileYes.push(tileIdx);
        } else if (m2) {
          const tileIdx = parseInt(m2![1]);
          const answer = m2![2].toUpperCase();
          _dbg(`tile ${tileIdx} → ${answer}`);
          if (answer === 'YES' && tileIdx >= 0 && tileIdx < actualTileCount) tileYes.push(tileIdx);
        }
      }

      try {
        const jsonMatch = response.match(/\{[^{}]*"yes"\s*:\s*\[[^\]]*\][^{}]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch![0]);
          if (Array.isArray(parsed.yes)) {
            for (const n of parsed.yes) {
              const num = parseInt(n);
              if (!isNaN(num) && num >= 0 && num < actualTileCount) matchedIndices.push(num);
            }
          }
        }
      } catch {}

      if (matchedIndices.length === 0 && tileYes.length > 0) {
        _dbg(`JSON missing, using per-tile YES: [${tileYes.join(',')}]`);
        matchedIndices.push(...tileYes);
      }

      const unique = [...new Set(matchedIndices)];
      matchedIndices.length = 0;
      matchedIndices.push(...unique);
      _dbg(`parsed indices: [${matchedIndices.join(',')}]`);

      // Per-tile fallback: when grid finds 0-1 tiles, try per-tile analysis
      if (!is3x3Flip && matchedIndices.length <= 1 && gridShot) {
        _dbg(`grid found only ${matchedIndices.length} tiles — trying per-tile fallback...`);
        try {
          const perTileFallback = await analyzeTileCrops(gridScreenshotPath, gridRows, gridCols, objectName, actualTileCount, _dbg);
          if (perTileFallback.length > matchedIndices.length) {
            matchedIndices.length = 0;
            matchedIndices.push(...perTileFallback);
            _dbg(`per-tile fallback: [${matchedIndices.join(',')}]`);
          }
        } catch (e: any) {
          _dbg(`per-tile fallback failed: ${e.message}`);
        }
      }

      // Two-pass zoom: disabled — grid-level prompt is thorough enough
      if (false && !is3x3Flip && matchedIndices.length > 6 && gridShot) {
        try {
          // Collect descriptions from response
          const tileDescs: Map<number, string> = new Map();
          for (let rawLine of response.split('\n')) {
            const line = rawLine.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim();
            const m1 = line.match(/^\[(\d+)\]:\s*(.+?)\s*→\s*(YES|NO)/i);
            if (m1) tileDescs.set(parseInt(m1![1]), m1![2].toLowerCase());
          }

          const rawObj = objectName.toLowerCase().replace('_', ' ');
          // Generate keyword variants: original, -s, -es, -ies
          const objVariants = new Set<string>([rawObj]);
          if (rawObj.endsWith('s')) objVariants.add(rawObj.slice(0, -1));
          if (rawObj.endsWith('es')) objVariants.add(rawObj.slice(0, -2));
          if (rawObj.endsWith('ies')) { objVariants.add(rawObj.slice(0, -3) + 'y'); objVariants.add(rawObj.slice(0, -1)); }
          // Add common synonyms for keyword matching
          const synonymExtra: Record<string, string[]> = {
            motorcycle: ['scooter', 'moped', 'motorbike'],
            bus: ['coach', 'transit'],
            fire_hydrant: ['hydrant'],
            traffic_light: ['traffic signal', 'stoplight'],
            crosswalk: ['zebra crossing', 'pedestrian crossing'],
          };
          // Find synonym map key by trying all singular forms
          const singulars = [rawObj, rawObj.endsWith('s') ? rawObj.slice(0, -1) : rawObj, rawObj.endsWith('es') ? rawObj.slice(0, -2) : rawObj];
          let extras: string[] = [];
          for (const s of singulars) {
            if (synonymExtra[s]) { extras = synonymExtra[s]; break; }
            if (synonymExtra[s.replace(' ', '_')]) { extras = synonymExtra[s.replace(' ', '_')]; break; }
          }
          const objKeywords = [...objVariants, ...extras];
          const toRemove: number[] = [];

          let zoomCount = 0;
          for (const idx of [...matchedIndices]) {
            const desc = tileDescs.get(idx) || '';
            const descMentionsObj = objKeywords.some(kw => kw.length > 2 && desc.includes(kw));

            if (!descMentionsObj) {
              // Vague description — zoom in and re-verify
              _dbg(`zoom verify tile ${idx}: vague desc "${desc.substring(0, 50)}" — re-checking...`);
              zoomCount++;
              try {
                const meta = await sharp(gridScreenshotPath).metadata();
                const imgW = meta.width || 0, imgH = meta.height || 0;
                if (imgW > 0 && imgH > 0) {
                  const tileW = Math.floor(imgW / gridCols), tileH = Math.floor(imgH / gridRows);
                  const r = Math.floor(idx / gridCols), c = idx % gridCols;
                  const left = c * tileW, top = r * tileH;
                  const w = (c === gridCols - 1) ? imgW - left : tileW;
                  const h = (r === gridRows - 1) ? imgH - top : tileH;
                  let tileBuf = await sharp(gridScreenshotPath).extract({ left, top, width: w, height: h }).toBuffer();
                  tileBuf = await sharp(tileBuf)
                    .resize(600, 600, { fit: 'inside', kernel: sharp.kernel.lanczos3 })
                    .normalize()
                    .sharpen({ sigma: 2.5, m1: 0.5, m2: 1.2 })
                    .modulate({ brightness: 1.15, saturation: 1.5 })
                    .png().toBuffer();
                  const zoomB64 = tileBuf.toString('base64');
                  const zoomPrompt = `Look at this single zoomed-in tile very carefully.
Does it contain a "${objectName}"? Be strict.
YES only if you can CLEARLY identify ${objectName}.
NO if it shows roads, buildings, sky, trees, other objects, or you are unsure.
Describe what you see in 5 words, then answer.
Describe: [5 words]
Answer: YES or NO`;
                  const zoomResp = await visionClassify(zoomB64, zoomPrompt);
                  const ansLine = zoomResp.split('\n').find(l => /^answer:/i.test(l.trim())) || zoomResp;
                  const isYes = /\byes\b/i.test(ansLine);
                  _dbg(`zoom verify tile ${idx}: ${isYes ? 'CONFIRMED' : 'REJECTED'} (${ansLine.substring(0, 60)})`);
                  if (!isYes) toRemove.push(idx);
                }
              } catch {}
            }
          }

          if (toRemove.length > 0) {
            const filtered = matchedIndices.filter(i => !toRemove.includes(i));
            if (filtered.length >= 2 || matchedIndices.length <= 2) {
              _dbg(`zoom verify removed: [${toRemove.join(',')}]`);
              matchedIndices.length = 0;
              matchedIndices.push(...filtered);
            } else {
              _dbg(`zoom verify would leave too few tiles, keeping original`);
            }
          }
        } catch (e: any) {
          _dbg(`zoom verify failed: ${e.message}`);
        }
      }

      const overClassThreshold = is3x3Flip ? actualTileCount * 0.8 : actualTileCount * 0.6;
      if (matchedIndices.length > overClassThreshold) {
        _dbg(`over-classification: ${matchedIndices.length}/${actualTileCount} — switching to per-tile analysis`);
        try {
          const perTileResult = await analyzeTileCrops(gridScreenshotPath, gridRows, gridCols, objectName, actualTileCount, _dbg);
          matchedIndices.length = 0;
          matchedIndices.push(...perTileResult);
          _dbg(`per-tile re-eval: [${matchedIndices.join(',')}]`);
        } catch (e: any) {
          _dbg(`per-tile re-eval failed: ${e.message} — keeping original`);
        }
      }

      // Per-tile cross-check disabled for speed — zoom verify handles uncertain tiles
      if (false && !is3x3Flip && gridShot && matchedIndices.length > 6) {
        _dbg(`grid over-classified (${matchedIndices.length} tiles) — running per-tile cross-check...`);
        try {
          const perTileBackup = await analyzeTileCrops(gridScreenshotPath, gridRows, gridCols, objectName, actualTileCount, _dbg);
          const gridSet = new Set(matchedIndices);
          const perTileSet = new Set(perTileBackup);
          const intersection = [...gridSet].filter(i => perTileSet.has(i));
          _dbg(`4x4 cross-check: grid=[${matchedIndices.join(',')}] per-tile=[${perTileBackup.join(',')}] intersection=[${intersection.join(',')}]`);
          if (intersection.length >= 2 && intersection.length <= 6) {
            matchedIndices.length = 0;
            matchedIndices.push(...intersection);
          }
        } catch (e: any) {
          _dbg(`per-tile cross-check failed: ${e.message}`);
        }
      }

    } catch (e: any) {
      _dbg(`vision analysis failed: ${e.message}`);
    }
    }

    // 4x4 batch verify disabled — zoom verify handles uncertain tiles
    if (false && !is3x3Flip && matchedIndices.length > 0 && gridShot) {
      try {
        _dbg(`4x4 batch verify: checking ${matchedIndices.length} YES tiles in 1 call...`);
        const verifyTiles: { idx: number; buf: Buffer }[] = [];
        for (const idx of [...matchedIndices]) {
          try {
            const domTile = domTileBufs.find(t => t.idx === idx);
            if (domTile) {
              const enhanced = await sharp(domTile!.buf).resize(400, 400, { fit: 'inside', kernel: sharp.kernel.lanczos3 }).sharpen({ sigma: 1.2 }).png().toBuffer();
              verifyTiles.push({ idx, buf: enhanced });
            } else {
              const meta = await sharp(gridScreenshotPath).metadata();
              const imgW = meta.width || 0, imgH = meta.height || 0;
              if (imgW === 0 || imgH === 0) continue;
              const tileW = Math.floor(imgW / gridCols), tileH = Math.floor(imgH / gridRows);
              const r = Math.floor(idx / gridCols), c = idx % gridCols;
              const left = c * tileW, top = r * tileH;
              const w = (c === gridCols - 1) ? imgW - left : tileW;
              const h = (r === gridRows - 1) ? imgH - top : tileH;
              let tileBuf = await sharp(gridScreenshotPath).extract({ left, top, width: w, height: h }).toBuffer();
              tileBuf = await sharp(tileBuf).resize(400, 400, { fit: 'inside', kernel: sharp.kernel.lanczos3 }).sharpen({ sigma: 1.2 }).png().toBuffer();
              verifyTiles.push({ idx, buf: tileBuf });
            }
          } catch {}
        }

        if (verifyTiles.length >= 2) {
          const cols = Math.ceil(Math.sqrt(verifyTiles.length));
          const rows = Math.ceil(verifyTiles.length / cols);
          const ts = 400;
          const gridW = cols * ts, gridH = rows * ts;
          const composites: any[] = [];
          for (let i = 0; i < verifyTiles.length; i++) {
            const r = Math.floor(i / cols), c = i % cols;
            composites.push({ input: verifyTiles[i].buf, left: c * ts, top: r * ts });
          }
          const verifyGrid = await sharp({ create: { width: gridW, height: gridH, channels: 3, background: { r: 200, g: 200, b: 200 } } }).composite(composites).png().toBuffer();
          const tileLabels = verifyTiles.map((t, i) => `[${i}]=tile${t.idx}`).join(', ');
          const prompt = `This image shows ${verifyTiles.length} tiles arranged in a grid (${tileLabels}).
For EACH tile, briefly describe what you see in 3-5 words. Focus on the main object.
Format:
[0]: [description]
[1]: [description]
...`;
          const resp = await visionClassify(verifyGrid.toString('base64'), prompt);
          _dbg(`4x4 batch verify response (${resp.length} chars)`);

          const synonymMap: Record<string, string[]> = {
            bus: ['bus', 'transit', 'public transport', 'coach'],
            car: ['car', 'sedan', 'hatchback', 'suv', 'vehicle', 'automobile', 'truck', 'pickup'],
            motorcycle: ['motorcycle', 'motorbike', 'moped', 'scooter'],
            bicycle: ['bicycle', 'bike', 'cyclist'],
            traffic_light: ['traffic light', 'traffic signal', 'stoplight', 'signal light'],
            fire_hydrant: ['fire hydrant', 'hydrant'],
            crosswalk: ['crosswalk', 'zebra crossing', 'pedestrian crossing'],
            stairs: ['stair', 'steps', 'staircase'],
            tractor: ['tractor', 'farm tractor', 'traktor'],
            taxi: ['taxi', 'cab', 'yellow cab'],
            bridge: ['bridge', 'overpass', 'viaduct'],
            mountain: ['mountain', 'hill', 'peak'],
            chimney: ['chimney', 'smokestack'],
          };
          const rawObjLower = objectName.toLowerCase().replace('_', ' ');
          const objLower = rawObjLower.replace(/s$/, '');
          const objForms = [rawObjLower, objLower, rawObjLower.replace(' ', '_'), objLower.replace(' ', '_')];
          let synonyms: string[] = [rawObjLower, objLower];
          for (const form of objForms) { if (synonymMap[form]) { synonyms = synonymMap[form]; break; } }

          const toRemove: number[] = [];
          for (let i = 0; i < verifyTiles.length; i++) {
            const cleanedLines = resp.split('\n').map(l => l.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim());
            const lineMatch = cleanedLines.find(l => new RegExp(`^\\[${i}\\]:`).test(l));
            const desc = lineMatch?.replace(/^\[\d+\]:\s*/i, '').trim() ?? '';
            const descLower = desc.toLowerCase();
            const keep = synonyms.some(s => descLower.includes(s));
            _dbg(`4x4 verify tile ${verifyTiles[i].idx}: ${keep ? 'KEEP' : 'REMOVE'} (desc: "${desc.substring(0, 80)}")`);
            sessionLog.verifyResults.push({ idx: verifyTiles[i].idx, kept: keep, description: desc.substring(0, 120) });
            if (!keep) toRemove.push(verifyTiles[i].idx);
          }

          if (toRemove.length > 0) {
            const filtered = matchedIndices.filter(i => !toRemove.includes(i));
            if (filtered.length < 2 && matchedIndices.length >= 2) {
              _dbg(`4x4 verify too aggressive: would leave ${filtered.length}, keeping original`);
            } else {
              _dbg(`4x4 verify removed: [${toRemove.join(',')}]`);
              matchedIndices.length = 0;
              matchedIndices.push(...filtered);
            }
          }
        }
      } catch (e: any) {
        _dbg(`4x4 batch verify failed: ${e.message}`);
      }
    }
  }

  // Quick verify disabled for 3x3 flip — causes false negatives
  // (removes correct tiles when short description doesn't mention target object)
  // Trust majority vote from direct sprite + grid-level analysis instead.
  if (false && is3x3Flip && matchedIndices.length > 0 && gridShot) {
    try {
      const image = sharp(gridScreenshotPath);
      const meta = await image.metadata();
      const imgW = meta.width || 0, imgH = meta.height || 0;
      if (imgW > 0 && imgH > 0) {
        const tileW = Math.floor(imgW / gridCols), tileH = Math.floor(imgH / gridRows);
        const toRemove: number[] = [];
        for (const idx of matchedIndices) {
          const r = Math.floor(idx / gridCols), c = idx % gridCols;
          const left = c * tileW, top = r * tileH;
          const w = (c === gridCols - 1) ? imgW - left : tileW;
          const h = (r === gridRows - 1) ? imgH - top : tileH;
          try {
            let tileBuf = await sharp(gridScreenshotPath).extract({ left, top, width: w, height: h }).toBuffer();
            if (w < 200 || h < 200) {
              const s = Math.max(1, Math.floor(300 / Math.max(w, h)));
              tileBuf = await sharp(tileBuf).resize(w * s, h * s, { kernel: sharp.kernel.lanczos3 }).png().toBuffer();
            } else {
              tileBuf = await sharp(tileBuf).png().toBuffer();
            }
            const b64 = tileBuf.toString('base64');
            const prompt = `What is the main object or subject visible in this image tile?
Describe the content in 5-10 words. Focus on the most prominent object(s).
Describe: [5-10 words]`;
            const resp = await visionClassify(b64, prompt);
            const descLine = resp.replace(/^describe:\s*/i, '').trim();
            const descLower = descLine.toLowerCase();
            const rawQObjLower = objectName.toLowerCase().replace('_', ' ');
            const qObjLower = rawQObjLower.replace(/s$/, '');
            const qObjForms = [rawQObjLower, qObjLower, rawQObjLower.replace(' ', '_'), qObjLower.replace(' ', '_')];

            const synonymMap: Record<string, string[]> = {
              bus: ['bus', 'transit', 'public transport', 'coach'],
              car: ['car', 'sedan', 'hatchback', 'suv', 'vehicle', 'automobile', 'truck', 'pickup'],
              motorcycle: ['motorcycle', 'motorbike', 'moped', 'scooter'],
              bicycle: ['bicycle', 'bike', 'cyclist'],
              traffic_light: ['traffic light', 'traffic signal', 'stoplight', 'signal light'],
              fire_hydrant: ['fire hydrant', 'hydrant'],
              crosswalk: ['crosswalk', 'zebra crossing', 'pedestrian crossing'],
              stairs: ['stair', 'steps', 'staircase'],
            };
            let synonyms: string[] = [rawQObjLower, qObjLower];
            for (const form of qObjForms) {
              if (synonymMap[form]) { synonyms = synonymMap[form]; break; }
            }
            const descMentionsObject = synonyms.some(s => descLower.includes(s));

            const contradictMap: Record<string, string[]> = {
              bus: ['no bus', 'not a bus', 'only a van', 'only a car', 'only a truck'],
              car: ['no car', 'not a car', 'only a motorcycle', 'only a bicycle'],
              motorcycle: ['no motorcycle', 'not a motorcycle', 'only a bicycle', 'only a car'],
              bicycle: ['no bicycle', 'not a bicycle', 'only a motorcycle'],
              traffic_light: ['no traffic light', 'street lamp', 'lamp post'],
              fire_hydrant: ['no fire hydrant', 'not a hydrant', 'only a mailbox'],
              crosswalk: ['no crosswalk', 'not a crosswalk', 'only a road'],
              stairs: ['no stairs', 'not stairs', 'only a ramp'],
            };
            let contradictions: string[] = [];
            for (const form of qObjForms) {
              if (contradictMap[form]) { contradictions = contradictMap[form]; break; }
            }
            const descContradicts = contradictions.some(c => descLower.includes(c));

            const keep = descMentionsObject && !descContradicts;
            _dbg(`verify tile ${idx}: ${keep ? 'KEEP' : 'REMOVE'} (desc: "${descLine.substring(0, 80)}")`);
            sessionLog.verifyResults.push({ idx, kept: keep, description: descLine.substring(0, 120) });
            if (!keep) toRemove.push(idx);
          } catch {}
        }
        if (toRemove.length > 0) {
          const filtered = matchedIndices.filter(i => !toRemove.includes(i));
          if (filtered.length === 0 && matchedIndices.length >= 2) {
            _dbg(`quick verify too aggressive: would remove all tiles, keeping original [${matchedIndices.join(',')}]`);
          } else {
            _dbg(`quick verify removed false positives: [${toRemove.join(',')}]`);
            matchedIndices.length = 0;
            matchedIndices.push(...filtered);
          }
        }
      }
    } catch (e: any) {
      _dbg(`quick verify failed: ${e.message}`);
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
          _save('SKIP_CLICKED');
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
        const tileBox = await visibleTiles[idx].boundingBox();
        if (tileBox) {
          const cx = tileBox.x + tileBox.width * (0.2 + Math.random() * 0.6);
          const cy = tileBox.y + tileBox.height * (0.2 + Math.random() * 0.6);
          await humanClickAt(cx, cy, page);
        } else {
          await frame.evaluate((tileIdx: number) => {
            const tds = document.querySelectorAll('table td');
            if (tds[tileIdx]) {
              const el = tds[tileIdx] as HTMLElement;
              el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              el.click();
            }
          }, idx);
        }
      } catch {
        await visibleTiles[idx].click({ force: true, timeout: 3000 });
      }
      clickedSet.add(idx);
      await page.waitForTimeout(450 + Math.random() * 650);
      _dbg(`clicked tile ${idx}`);
    } catch (e: any) {
      try {
        const refreshed = await findGridTiles(frame, provider);
        const refreshedVisible: any[] = [];
        for (const t of refreshed) { try { if (await t.isVisible()) refreshedVisible.push(t); } catch {} }
        if (idx < refreshedVisible.length) {
          try {
            const rBox = await refreshedVisible[idx].boundingBox();
            if (rBox) {
              const rcx = rBox.x + rBox.width * (0.2 + Math.random() * 0.6);
              const rcy = rBox.y + rBox.height * (0.2 + Math.random() * 0.6);
              await humanClickAt(rcx, rcy, page);
            } else {
              await frame.evaluate((tileIdx: number) => {
                const tds = document.querySelectorAll('table td');
                if (tds[tileIdx]) (tds[tileIdx] as HTMLElement).click();
              }, idx);
            }
          } catch {
            await refreshedVisible[idx].click({ force: true, timeout: 3000 });
          }
          clickedSet.add(idx);
          await page.waitForTimeout(450 + Math.random() * 650);
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

  // ============================================
  // # DONT CHANGE ANYTHING HERE - 3x3 FLIP MULTI-ROUND
  // Handles re-clicking flipped tiles. Working correctly.
  // ============================================
  // 3x3 flip: multi-round selection — keep checking flipped tiles for more matches
  if (is3x3Flip && clickedSet.size > 0) {
    let lastClickedCount = clickedSet.size;

    // Save canvas data of clicked tiles BEFORE flip for comparison
    let preFlipCanvas: string[] = [];
    try {
      preFlipCanvas = await frame.evaluate((clickedIndices: number[]) => {
        const tables = document.querySelectorAll('table');
        let cells: Element[] = [];
        for (const table of tables) {
          const tds = Array.from(table.querySelectorAll('td'));
          if (tds.length >= clickedIndices.length) { cells = tds; break; }
        }
        return clickedIndices.map(idx => {
          if (idx >= cells.length) return '';
          const img = cells[idx].querySelector('img') as HTMLImageElement | null;
          if (!img || !img.complete) return '';
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || 100; canvas.height = img.naturalHeight || 100;
            const ctx = canvas.getContext('2d');
            if (ctx) { ctx.drawImage(img, 0, 0); return canvas.toDataURL('image/png').substring(0, 100); }
          } catch {}
          return '';
        });
      }, [...clickedSet].sort((a, b) => a - b));
    } catch {}

    const positionClickCount = new Map<number, number>();
    for (const idx of clickedSet) positionClickCount.set(idx, 1);

    for (let round = 0; round < 5; round++) {
      // Smart flip detection: poll canvas data until clicked tiles change (min 4s, max 15s)
      await page.waitForTimeout(4000);
      let flipDetected = false;
      for (let poll = 0; poll < 22; poll++) {
        await page.waitForTimeout(500);
        try {
          const changed = await frame.evaluate((params: { clickedIndices: number[], preData: string[] }) => {
            const tables = document.querySelectorAll('table');
            let cells: Element[] = [];
            for (const table of tables) {
              const tds = Array.from(table.querySelectorAll('td'));
              if (tds.length >= 9) { cells = tds; break; }
            }
            let changedCount = 0;
            for (let i = 0; i < params.clickedIndices.length; i++) {
              const idx = params.clickedIndices[i];
              if (idx >= cells.length) continue;
              const img = cells[idx].querySelector('img') as HTMLImageElement | null;
              if (!img || !img.complete) continue;
              try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || 100; canvas.height = img.naturalHeight || 100;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.drawImage(img, 0, 0);
                  const newData = canvas.toDataURL('image/png').substring(0, 100);
                  if (newData !== params.preData[i]) changedCount++;
                }
              } catch {}
            }
            return changedCount;
          }, { clickedIndices: [...clickedSet].sort((a, b) => a - b), preData: preFlipCanvas });
          if (changed >= Math.ceil(clickedSet.size * 0.5)) {
            flipDetected = true;
            _dbg(`3x3 flip round ${round + 1}: ${changed}/${clickedSet.size} tiles changed after ${(poll + 1) * 0.5 + 4}s`);
            break;
          }
        } catch {}
      }
      if (!flipDetected) {
        _dbg(`3x3 flip round ${round + 1}: flip not detected after 15s, proceeding anyway`);
      }

      _dbg(`3x3 flip round ${round + 1}: analyzing after flip...`);

      try {
        await frame.evaluate(async () => {
          const imgs = document.querySelectorAll('table td img');
          await Promise.all(Array.from(imgs).map(img => {
            if ((img as HTMLImageElement).complete) return Promise.resolve();
            return new Promise<void>(resolve => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
              setTimeout(resolve, 3000);
            });
          }));
        });
      } catch {}
      // Brief wait for flip animation to fully render
      await page.waitForTimeout(1000);
      _dbg(`3x3 flip round ${round + 1}: images loaded, analyzing...`);

      try {
        const tileDataUrls2 = await frame.evaluate(async (expectedCount: number) => {
          const tables = document.querySelectorAll('table');
          let cells: Element[] = [];
          for (const table of tables) {
            const tds = Array.from(table.querySelectorAll('td'));
            if (tds.length >= expectedCount) { cells = tds; break; }
          }
          if (cells.length === 0) return { results: [] as string[], cellCount: 0, imgCount: 0 };
          const results: string[] = [];
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const img = cell.querySelector('img') as HTMLImageElement | null;
            if (img && img.complete && img.naturalWidth > 0) {
              const cs = getComputedStyle(img);
              const wrapper = cell.querySelector('.rc-image-tile-wrapper') as HTMLElement;
              const wcs = wrapper ? getComputedStyle(wrapper) : null;
              const wW = wrapper ? parseInt(wcs!.width) || 95 : 95;
              const isSpriteTile = img.naturalWidth > wW * 1.5;
              if (isSpriteTile) {
                try {
                  const offX = (parseInt(cs.left) || 0) + (parseInt(cs.marginLeft) || 0);
                  const offY = (parseInt(cs.top) || 0) + (parseInt(cs.marginTop) || 0);
                  const scale = img.naturalWidth / (parseInt(cs.width) || img.offsetWidth || wW);
                  const sx = Math.max(0, -offX * scale), sy = Math.max(0, -offY * scale);
                  const sw = wW * scale, sh = (wrapper ? parseInt(wcs!.height) || 95 : 95) * scale;
                  const canvas = document.createElement('canvas');
                  canvas.width = Math.round(sw); canvas.height = Math.round(sh);
                  const ctx = canvas.getContext('2d');
                  if (ctx) { ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh); results.push(canvas.toDataURL('image/png')); continue; }
                } catch {}
              } else {
                try {
                  const canvas = document.createElement('canvas');
                  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
                  const ctx = canvas.getContext('2d');
                  if (ctx) { ctx.drawImage(img, 0, 0); results.push(canvas.toDataURL('image/png')); continue; }
                } catch {}
              }
            }
            results.push('');
          }
          return { results, cellCount: cells.length, imgCount: results.filter(r => r).length };
        }, actualTileCount);

        if (!tileDataUrls2.imgCount || tileDataUrls2.imgCount < actualTileCount) {
          _dbg(`3x3 flip round ${round + 1}: not enough tile images (${tileDataUrls2.imgCount}), skipping`);
          break;
        }

        const dataResults = (tileDataUrls2 as any).results as string[];
        const tileBufs: { idx: number; buf: Buffer }[] = [];
        for (let i = 0; i < Math.min(dataResults.length, actualTileCount); i++) {
          const entry = dataResults[i];
          if (!entry || !entry.startsWith('data:image/')) continue;
          try {
            const b64 = entry.split(',')[1];
            if (b64) tileBufs.push({ idx: i, buf: Buffer.from(b64, 'base64') });
          } catch {}
        }

        if (tileBufs.length < actualTileCount) { _dbg(`3x3 flip round ${round + 1}: decode failed`); break; }

        const meta0 = await sharp(tileBufs[0].buf).metadata();
        const rawW = meta0.width || 100, rawH = meta0.height || 100;
        const MIN_TILE = 200;
        const tw = rawW < MIN_TILE ? MIN_TILE : rawW, th = rawH < MIN_TILE ? MIN_TILE : rawH;
        const gridW = tw * gridCols, gridH = th * gridRows;
        const composites: any[] = [];
        for (const { idx, buf } of tileBufs) {
          const r = Math.floor(idx / gridCols), c = idx % gridCols;
          const tileBuf = (rawW < MIN_TILE || rawH < MIN_TILE)
            ? await sharp(buf).resize(tw, th, { kernel: sharp.kernel.lanczos3 }).png().toBuffer() : buf;
          composites.push({ input: tileBuf, left: c * tw, top: r * th });
        }
        const composedBuf = await sharp({ create: { width: gridW, height: gridH, channels: 3, background: { r: 200, g: 200, b: 200 } } })
          .composite(composites).png().toBuffer();
        await sharp(composedBuf).toFile(gridScreenshotPath);
        try { await sharp(composedBuf).toFile(join(homedir(), `.aurix-postflip-round${round + 1}.png`)); } catch {}

        // Grid-level analysis only (fast: 1 API call per round)
        let newMatches: number[] = [];
        try {
          const tileLayout = Array.from({ length: gridRows }, (_, r) => {
            const tiles = Array.from({ length: gridCols }, (_, c) => {
              const idx = r * gridCols + c;
              return idx < actualTileCount ? `[${idx}]` : '';
            });
            return `Row ${r + 1} (left to right): ${tiles.join(' ')}`;
          }).join('\n');
          const gridPrompt = `Grid: ${gridSize} (${actualTileCount} tiles)
${tileLayout}
Find ALL tiles containing "${objectName}".
YES if you can clearly identify ${objectName}. NO if unsure.
[N]: YES/NO
Answer: {"yes": [numbers]}`;
          const gridBuf = await sharp(gridScreenshotPath).resize(1200, 1200, { fit: 'inside' }).normalize().sharpen({ sigma: 1.5, m1: 0.5, m2: 0.8 }).modulate({ brightness: 1.1, saturation: 1.4 }).png().toBuffer();
          const gridResp = await visionClassify(gridBuf.toString('base64'), gridPrompt);
          const tileYes: number[] = [];
          for (let rawLine of gridResp.split('\n')) {
            const line = rawLine.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim();
            const m1 = line.match(/^\[(\d+)\]:\s*(.+?)\s*→\s*(YES|NO)/i);
            const m2 = line.match(/^\[(\d+)\]:\s*(YES|NO)/i);
            if (m1) { const ti = parseInt(m1[1]); if (m1[3].toUpperCase() === 'YES' && ti < actualTileCount) tileYes.push(ti); }
            else if (m2) { const ti = parseInt(m2[1]); if (m2[2].toUpperCase() === 'YES' && ti < actualTileCount) tileYes.push(ti); }
          }
          try {
            const jm = gridResp.match(/\{[^{}]*"yes"\s*:\s*\[[^\]]*\][^{}]*\}/);
            if (jm) { const p = JSON.parse(jm[0]); if (Array.isArray(p.yes)) for (const n of p.yes) { const num = parseInt(n); if (!isNaN(num) && num < actualTileCount) newMatches.push(num); } }
          } catch {}
          if (newMatches.length === 0 && tileYes.length > 0) newMatches = tileYes;
          newMatches = [...new Set(newMatches)];
          _dbg(`3x3 flip round ${round + 1} grid-level: [${newMatches.join(',')}]`);
        } catch (e: any) { _dbg(`mr grid-level failed: ${e.message}`); }

        // Click tiles showing target, but max 2 clicks per position
        const thisRoundClicks = new Set<number>();
        const clicks = newMatches.filter(idx => !thisRoundClicks.has(idx) && (positionClickCount.get(idx) || 0) < 4);
        _dbg(`3x3 flip round ${round + 1}: matches=[${newMatches.join(',')}] clicks=[${clicks.join(',')}]`);

        if (clicks.length === 0) {
          _dbg(`3x3 flip round ${round + 1}: no clickable matches — done`);
          break;
        }

        for (const idx of clicks) {
          if (idx >= actualTileCount || idx >= visibleTiles.length) continue;
          try {
            const tileBox = await visibleTiles[idx].boundingBox();
            if (tileBox) {
              const cx = tileBox.x + tileBox.width * (0.2 + Math.random() * 0.6);
              const cy = tileBox.y + tileBox.height * (0.2 + Math.random() * 0.6);
              await humanClickAt(cx, cy, page);
            } else {
              await frame.evaluate((tileIdx: number) => {
                const tds = document.querySelectorAll('table td');
                if (tds[tileIdx]) (tds[tileIdx] as HTMLElement).click();
              }, idx);
            }
            clickedSet.add(idx);
            thisRoundClicks.add(idx);
            positionClickCount.set(idx, (positionClickCount.get(idx) || 0) + 1);
            await page.waitForTimeout(450 + Math.random() * 650);
            _dbg(`clicked tile ${idx} (round ${round + 1})`);
          } catch {}
        }

        lastClickedCount = clickedSet.size;

        // Update pre-flip canvas for next round comparison
        try {
          preFlipCanvas = await frame.evaluate((clickedIndices: number[]) => {
            const tables = document.querySelectorAll('table');
            let cells: Element[] = [];
            for (const table of tables) {
              const tds = Array.from(table.querySelectorAll('td'));
              if (tds.length >= 9) { cells = tds; break; }
            }
            return clickedIndices.map(idx => {
              if (idx >= cells.length) return '';
              const img = cells[idx].querySelector('img') as HTMLImageElement | null;
              if (!img || !img.complete) return '';
              try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || 100; canvas.height = img.naturalHeight || 100;
                const ctx = canvas.getContext('2d');
                if (ctx) { ctx.drawImage(img, 0, 0); return canvas.toDataURL('image/png').substring(0, 100); }
              } catch {}
              return '';
            });
          }, [...clickedSet].sort((a, b) => a - b));
        } catch {}
      } catch (e: any) {
        _dbg(`3x3 flip round ${round + 1} failed: ${e.message}`);
        break;
      }
    }
  }

  if (isRecaptcha && clickedSet.size > 0 && !is3x3Flip) {
    await page.waitForTimeout(800 + Math.random() * 400);

    try {
      const selectedStatus: { idx: number; selected: boolean; classes: string }[] = await frame.evaluate((expectedIndices: number[]) => {
        const tds = document.querySelectorAll('table td');
        const result: { idx: number; selected: boolean; classes: string }[] = [];
        for (const idx of expectedIndices) {
          const td = tds[idx] as HTMLElement | undefined;
          if (!td) continue;
          const classes = td.className + ' ' + (td.querySelector('[class]')?.className || '');
          const isSelected = /selected|checked|active/i.test(classes) ||
            !!td.querySelector('.rc-imageselect-tile-selected, .rc-imageselect-dynamic-selected') ||
            td.getAttribute('aria-checked') === 'true' ||
            td.querySelector('[aria-checked="true"]') !== null;
          result.push({ idx, selected: isSelected, classes: classes.substring(0, 100) });
        }
        return result;
      }, [...clickedSet].sort((a, b) => a - b));

      const unselected = selectedStatus.filter(s => !s.selected);
      if (unselected.length > 0 && unselected.length < clickedSet.size) {
        _dbg(`tile verify: ${unselected.length}/${clickedSet.size} not selected: [${unselected.map(s => s.idx).join(',')}]`);
        for (const s of unselected) {
          try {
            if (s.idx < visibleTiles.length) {
              const rBox = await visibleTiles[s.idx].boundingBox();
              if (rBox) {
                const rcx = rBox.x + rBox.width * (0.2 + Math.random() * 0.6);
                const rcy = rBox.y + rBox.height * (0.2 + Math.random() * 0.6);
                await humanClickAt(rcx, rcy, page);
              } else {
                await frame.evaluate((tileIdx: number) => {
                  const tds = document.querySelectorAll('table td');
                  if (tds[tileIdx]) {
                    const el = tds[tileIdx] as HTMLElement;
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    el.click();
                  }
                }, s.idx);
              }
            }
            await page.waitForTimeout(450 + Math.random() * 650);
            _dbg(`re-clicked tile ${s.idx}`);
          } catch {}
        }
        await page.waitForTimeout(800);
      } else if (unselected.length === 0) {
        _dbg(`tile verify: all ${clickedSet.size} tiles confirmed selected`);
      }
    } catch (e: any) {
      _dbg(`tile verify error: ${e.message?.substring(0, 60)}`);
    }
  }

  let preClickSpriteUrl = '';
  try {
    preClickSpriteUrl = await frame.evaluate(() => {
      const img = document.querySelector('table td img') as HTMLImageElement | null;
      return img ? img.src : '';
    });
  } catch {}

  const is4x4 = !is3x3;
  const buttonLabel = is4x4 ? 'next' : 'verify';

  // Wait before clicking verify — minimal delay
  if (is3x3Flip) {
    await page.waitForTimeout(1000);
  } else {
    await page.waitForTimeout(800 + Math.random() * 700);
  }

  _dbg(`clicking ${buttonLabel} button...`);
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

    _dbg(`${buttonLabel} button clicked, waiting for result...`);
    await page.waitForTimeout(is4x4 ? 3000 : 2000);

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
      _dbg(`verify result: VERIFIED (token=${hasToken}, aria=${ariaChecked})`);
      results.push(`[VERIFIED] token=${hasToken}, aria=${ariaChecked}`);
      _save('VERIFIED');
      return results.join('\n');
    }

    const currentFrames = page.frames();
    const stillHasBframe = currentFrames.some((f: any) => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
    if (!stillHasBframe) {
      _dbg('verify result: bframe disappeared');
      results.push(`[BFRAME_GONE]`);
      _save('BFRAME_GONE');
      return results.join('\n');
    }

    const errorEl = frame.locator('.rc-imageselect-incorrect-response, .error-message, .incorrect').first();
    const errorVisible = await errorEl.count() > 0 && await errorEl.isVisible().catch(() => false);
    if (errorVisible) {
      _dbg('verify result: FAILED - error shown');
      results.push('[FAILED] incorrect answer');

      // === AUDIO BYPASS FALLBACK ===
      if (audioFallback) {
        try {
          const hasAudio = await checkAudioButton(frame);
          if (hasAudio) {
            _dbg('Image solver failed (error) — trying audio bypass fallback...');
            await page.waitForTimeout(3000);
            const audioResult = await solveAudioCaptcha(page, frame);
            if (audioResult.success) {
              _dbg(`AUDIO BYPASS SUCCESS! Transcription: "${audioResult.transcription}"`);
              results.push(`[VERIFIED] audio bypass: "${audioResult.transcription}"`);
              _save('VERIFIED - audio bypass');
              return results.join('\n');
            }
          }
        } catch (e: any) {
          _dbg(`Audio bypass fallback error: ${e.message}`);
        }
      }

      _save('FAILED - error shown');
      return results.join('\n');
    }

    const newChallenge = await frame.locator('.rc-imageselect-instructions, .prompt-text').count();
    if (newChallenge > 0) {
      const newInstr = (await frame.locator('.rc-imageselect-instructions, .prompt-text').first().textContent() || '').trim();
      if (newInstr !== instruction) {
        _dbg(`verify result: new challenge appeared: "${newInstr}"`);
        results.push(`[NEW_CHALLENGE] "${newInstr.substring(0, 60)}"`);
        _save('NEW_CHALLENGE');
        return results.join('\n');
      }

      if (is4x4 && preClickSpriteUrl) {
        let newSpriteUrl = '';
        try {
          newSpriteUrl = await frame.evaluate(() => {
            const img = document.querySelector('table td img') as HTMLImageElement | null;
            return img ? img.src : '';
          });
        } catch {}
        if (newSpriteUrl && newSpriteUrl !== preClickSpriteUrl) {
          _dbg(`verify result: same type sub-challenge (tiles changed, 4x4 Next)`);
          results.push(`[NEW_CHALLENGE] same type, new tiles (4x4)`);
          _save('NEW_CHALLENGE same type');
          return results.join('\n');
        }
      }

      _dbg('verify result: same challenge still present');
      results.push('[SAME_CHALLENGE] answer was wrong');

      // === AUDIO BYPASS FALLBACK ===
      if (audioFallback) {
        try {
          const hasAudio = await checkAudioButton(frame);
          if (hasAudio) {
            _dbg('Image solver failed — trying audio bypass fallback...');
            await page.waitForTimeout(3000); // human-like pause
            const audioResult = await solveAudioCaptcha(page, frame);
            if (audioResult.success) {
              _dbg(`AUDIO BYPASS SUCCESS! Transcription: "${audioResult.transcription}"`);
              results.push(`[VERIFIED] audio bypass: "${audioResult.transcription}"`);
              _save('VERIFIED - audio bypass');
              return results.join('\n');
            } else {
              _dbg(`Audio bypass failed — returning image solver failure`);
            }
          }
        } catch (e: any) {
          _dbg(`Audio bypass fallback error: ${e.message}`);
        }
      }

      _save('FAILED - same challenge');
      return results.join('\n');
    }

    _dbg('verify result: unknown state');
    results.push('[UNKNOWN] could not determine verify result');

    // === AUDIO BYPASS FALLBACK (unknown state) ===
    if (audioFallback) {
      try {
        const hasAudio = await checkAudioButton(frame);
        if (hasAudio) {
          _dbg('Unknown verify state — trying audio bypass fallback...');
          await page.waitForTimeout(3000);
          const audioResult = await solveAudioCaptcha(page, frame);
          if (audioResult.success) {
            _dbg(`AUDIO BYPASS SUCCESS! Transcription: "${audioResult.transcription}"`);
            results.push(`[VERIFIED] audio bypass: "${audioResult.transcription}"`);
            _save('VERIFIED - audio bypass');
            return results.join('\n');
          }
        }
      } catch (e: any) {
        _dbg(`Audio bypass fallback error: ${e.message}`);
      }
    }

    _save('UNKNOWN');
    return results.join('\n');
  } catch (e: any) {
    _dbg(`Verify FAILED: ${e.message}`);
    results.push(`Verify failed: ${e.message}`);
    _save(`VERIFY_ERROR: ${e.message}`);
    return results.join('\n');
  }
}
