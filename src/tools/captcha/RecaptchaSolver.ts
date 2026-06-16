import { homedir } from 'os';
import { join } from 'path';
import { readdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from 'fs';
import sharp from 'sharp';
import { visionClassify, readFileBase64, loadCaptchaTraining, saveCaptchaTraining, findGridTiles } from './common.js';

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
    await page.waitForTimeout(1500);
    _dbg(`frame url: ${frame.url().substring(0, 120)}`);

    try { await frame.locator('.rc-imageselect-instructions, .prompt-text, .prompt-text-h').first().waitFor({ state: 'visible', timeout: 5000 }); } catch {}

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

  const tileBufs: { idx: number; buf: Buffer }[] = [];
  for (let i = 0; i < Math.min(visibleTiles.length, actualTileCount); i++) {
    try {
      const tilePath = join(homedir(), `.aurix-tile-ss-${i}.png`);
      await visibleTiles[i].screenshot({ path: tilePath, timeout: 8000 });
      tileBufs.push({ idx: i, buf: readFileSync(tilePath) });
      try { unlinkSync(tilePath); } catch {}
    } catch (e: any) {
      _dbg(`tile ${i} screenshot failed: ${e.message?.substring(0, 60)}`);
    }
  }

  if (tileBufs.length === actualTileCount) {
    try {
      const meta0 = await sharp(tileBufs[0].buf).metadata();
      const tw = meta0.width || 97, th = meta0.height || 97;
      const gridW = tw * gridCols, gridH = th * gridRows;
      const composites: any[] = [];
      for (const { idx, buf } of tileBufs) {
        const r = Math.floor(idx / gridCols), c = idx % gridCols;
        composites.push({ input: buf, left: c * tw, top: r * th });
      }
      await sharp({ create: { width: gridW, height: gridH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
        .composite(composites).png().toFile(gridScreenshotPath);
      gridShot = true;
      gridShotFromTable = true;
      _dbg(`composed grid from ${tileBufs.length} tiles: ${gridW}x${gridH}`);
    } catch (e: any) {
      _dbg(`compose grid failed: ${e.message}`);
    }
  }

  if (!gridShot) {
    _dbg('tile screenshots failed, trying grid-level screenshot...');
    const tableSelectors = isRecaptcha
      ? (is3x3
          ? ['.rc-imageselect-table-33', '.rc-image-tile-33', 'table']
          : ['.rc-imageselect-table-44', '.rc-image-tile-44', 'table'])
      : ['.task', '.challenge-view'];
    for (const sel of tableSelectors) {
      if (gridShot) break;
      try {
        const el = frame.locator(sel).first();
        if (await el.count() > 0 && await el.isVisible()) {
          await el.screenshot({ path: gridScreenshotPath, timeout: 10000 });
          gridShot = true;
          gridShotFromTable = true;
          _dbg(`grid screenshot: ${sel}`);
        }
      } catch {}
    }
    if (!gridShot) {
      try { await frame.locator('body').screenshot({ path: gridScreenshotPath, timeout: 10000 }); gridShot = true; } catch {}
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

      const trainingExamples = loadCaptchaTraining().filter(e => e.instruction.toLowerCase().includes(objectName.toLowerCase()) || objectName.toLowerCase().includes(e.instruction.toLowerCase()));
      let trainingHint = '';
      if (trainingExamples.length > 0) {
        const last = trainingExamples[trainingExamples.length - 1];
        trainingHint = `\n\nHint: A similar challenge was solved before by selecting tiles [${last.matchedIndices.join(',')}] out of ${last.gridCount}.`;
      }

      const prompt = `This is a reCAPTCHA image grid (${gridSize}, ${actualTileCount} tiles). Each tile is a separate photo.

${tileLayout.trim()}

Task: Which tiles contain "${objectName}"? Select tiles showing ANY part of ${objectName}, including related parts (e.g. a pole holding a traffic light, crosswalk markings, a vehicle that IS a bus).

IMPORTANT: You MUST respond in exactly this format:

Analysis: [brief tile-by-tile notes, e.g. "Tile 0: no, Tile 1: yes - shows traffic light, ..."]
Answer: [comma-separated 0-indexed tile numbers that contain ${objectName}]

If no tiles match, write: Answer: none${trainingHint}`;

      _dbg('calling visionClassify...');
      const gridBase64 = readFileBase64(gridScreenshotPath);
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

      if (answerLine && !/none/i.test(answerLine.replace(/answer\s*:/i, ''))) {
        const nums = answerLine.match(/\d+/g);
        if (nums) {
          for (const n of nums) {
            let idx = parseInt(n);
            if (idx >= 0 && idx < actualTileCount) matchedIndices.push(idx);
          }
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
      _dbg(`parsed matched indices: [${matchedIndices.join(',')}]`);
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
        let skipBtn = frame.locator('#recaptcha-verify-button, .rc-button-submit');
        const skipText = await skipBtn.textContent().catch(() => '');
        if (/skip/i.test(skipText)) {
          await skipBtn.click({ force: true, timeout: 5000 });
          await page.waitForTimeout(2000);
          _dbg('skip button clicked');
          results.push('No matches found, clicked skip');
          return results.join('\n');
        }
      } catch {}
    }
    results.push('No matching tiles found, attempting verify anyway');
  }
  _dbg(`clicking ${matchedIndices.length} tiles`);

  const clickedSet = new Set<number>();
  for (const idx of matchedIndices) {
    try {
      if (idx >= actualTileCount || idx >= visibleTiles.length) continue;
      await visibleTiles[idx].click({ force: true, timeout: 3000 });
      clickedSet.add(idx);
      await page.waitForTimeout(300 + Math.random() * 400);
      _dbg(`clicked tile ${idx}`);
    } catch (e: any) {
      try {
        const refreshed = await findGridTiles(frame, provider);
        const refreshedVisible: any[] = [];
        for (const t of refreshed) { try { if (await t.isVisible()) refreshedVisible.push(t); } catch {} }
        if (idx < refreshedVisible.length) {
          await refreshedVisible[idx].click({ force: true, timeout: 3000 });
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
    let verifyBtn = frame.locator('#recaptcha-verify-button, .rc-button-submit, .button-submit, [id*="verify"]');
    if (await verifyBtn.count() === 0) {
      verifyBtn = frame.locator('button:has-text("Verify"), button:has-text("Next"), button:has-text("Submit")');
    }

    if (await verifyBtn.count() > 0) {
      await verifyBtn.click({ force: true, timeout: 5000 });
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
        saveCaptchaTraining({ instruction: cleanInstruction, gridCount: actualTileCount, matchedIndices, timestamp: Date.now() });
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
        saveCaptchaTraining({ instruction: cleanInstruction, gridCount: actualTileCount, matchedIndices, timestamp: Date.now() });
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
      saveCaptchaTraining({ instruction: cleanInstruction, gridCount: actualTileCount, matchedIndices, timestamp: Date.now() });
      _dbg('CAPTCHA SOLVED (no error, no challenge)');
      results.push(`[OK] CAPTCHA SOLVED! ✅`);
      results.push(`→ The form can now be submitted. Click the submit/register button to continue.`);
      return results.join('\n');
    } else {
      _dbg('NO verify button found');
      results.push('[WARN] No verify button found');
      return results.join('\n');
    }
  } catch (e: any) {
    _dbg(`Verify FAILED: ${e.message}`);
    results.push(`Verify failed: ${e.message}`);
    return results.join('\n');
  }
}
