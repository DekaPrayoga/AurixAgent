import { type Page } from 'playwright-core';
import { homedir } from 'os';
import { join } from 'path';
import { readdirSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { findGridTiles, humanClick, warmupBehavior } from './common.js';
import { solveCaptchaGrid } from './RecaptchaSolver.js';

export let _lastGridAnalyzeTime = 0;

export function setLastGridAnalyzeTime(t: number) {
  _lastGridAnalyzeTime = t;
}

export async function autoSolveCaptcha(p: Page): Promise<string[]> {
  const results: string[] = [];
  const frames = p.frames();

  let recaptchaAnchor: any = null;
  let recaptchaBframe: any = null;
  let geetestSlider: any = null;
  let turnstileFrame: any = null;

  for (const frame of frames) {
    const url = frame.url();
    if (url.includes('/recaptcha/') && url.includes('/anchor')) recaptchaAnchor = frame;
    if (url.includes('/recaptcha/') && url.includes('/bframe')) recaptchaBframe = frame;
    if (url.includes('geetest.com') || url.includes('captcha.com')) {
      const hasSlider = await frame.locator('.geetest_slider_button, .geetest_slider').count();
      if (hasSlider > 0) geetestSlider = frame;
    }
    if (url.includes('challenges.cloudflare') || url.includes('turnstile')) turnstileFrame = frame;
  }

  if (turnstileFrame) {
    try {
      const checkbox = turnstileFrame.locator('input[type="checkbox"], .cf-turnstile, [role="checkbox"]').first();
      if (await checkbox.count() > 0) {
        await checkbox.click({ timeout: 5000 });
        await p.waitForTimeout(3000);
        const tsOk = await turnstileFrame.locator('input[type="hidden"][name="cf-turnstile-response"], [data-state="success"], .success').count().catch(() => 0);
        const tsError = await turnstileFrame.locator('.error, [data-state="error"], [data-state="failed"]').count().catch(() => 0);
        if (tsOk > 0) results.push('Turnstile: checkbox clicked, widget reports success');
        else if (tsError > 0) results.push('Turnstile: checkbox clicked but widget shows an error — may need a screenshot to inspect');
        else results.push('Turnstile: checkbox clicked, outcome unconfirmed — take a screenshot to verify the page advanced before submitting');
      }
    } catch (e: any) {
      results.push(`Turnstile: auto-click attempted (${e.message?.slice(0, 80)})`);
    }
  }

  if (recaptchaAnchor && !recaptchaBframe) {
    try {
      const checkbox = recaptchaAnchor.locator('#recaptcha-anchor, .recaptcha-checkbox-border, .rc-anchor-checkbox').first();
      if (await checkbox.count() > 0) {
        await checkbox.click({ timeout: 5000 });
        await p.waitForTimeout(2000);
        const checked = await recaptchaAnchor.locator('.recaptcha-checkbox-checked, .rc-anchor-checkbox-checked').count().catch(() => 0);
        const challengeOpened = p.frames().some((f: any) => f.url().includes('/recaptcha/') && f.url().includes('/bframe'));
        if (checked > 0) results.push('reCAPTCHA: checkbox verified (checked) — no image challenge');
        else if (challengeOpened) results.push('reCAPTCHA: checkbox clicked, image challenge appeared — use captcha-grid to solve it');
        else results.push('reCAPTCHA: checkbox clicked, outcome unconfirmed — take a screenshot to verify before submitting');
      }
    } catch (e: any) {
      results.push(`reCAPTCHA checkbox: auto-click attempted (${e.message?.slice(0, 80)})`);
    }
  }

  if (geetestSlider) {
    try {
      const sliderInfo = await geetestSlider.evaluate(() => {
        const info: Record<string, any> = {};
        const cut = document.querySelector('.geetest_cut, .geetest_piece_bg, [class*="geetest_cut"], [class*="slider_cut"]');
        if (cut) {
          const cutRect = cut.getBoundingClientRect();
          const style = window.getComputedStyle(cut);
          info.cut = { left: cutRect.left, width: cutRect.width, styleLeft: parseFloat(style.left) || null, transform: style.transform || null };
        }
        const bg = document.querySelector('.geetest_canvas_bg, .geetest_bg, [class*="geetest_canvas"], canvas[class*="bg"]');
        if (bg) info.bg = { left: bg.getBoundingClientRect().left, width: bg.getBoundingClientRect().width };
        const piece = document.querySelector('.geetest_piece, [class*="slider_piece"]');
        if (piece) info.piece = { width: piece.getBoundingClientRect().width };
        const slider = document.querySelector('.geetest_slider_button, [class*="slider_button"]');
        if (slider) {
          const r = slider.getBoundingClientRect();
          info.slider = { left: r.left, width: r.width, centerX: r.left + r.width / 2, centerY: r.top + r.height / 2 };
        }
        return info;
      });

      let gapOffset: number | null = null;
      if (sliderInfo.cut && sliderInfo.bg) {
        if (sliderInfo.cut.styleLeft && sliderInfo.cut.styleLeft > 0) gapOffset = Math.round(sliderInfo.cut.styleLeft);
        else gapOffset = Math.round(sliderInfo.cut.left - sliderInfo.bg.left);
      }
      if (gapOffset === null && sliderInfo.cut?.transform && sliderInfo.cut.transform !== 'none') {
        const match = sliderInfo.cut.transform.match(/matrix\(.*?,\s*([\d.]+)/);
        if (match) gapOffset = Math.round(parseFloat(match[1]));
      }

      if (gapOffset !== null && sliderInfo.slider) {
        const pieceHalf = Math.round((sliderInfo.piece?.width || 44) / 2);
        const dragDistance = gapOffset - pieceHalf;
        const startX = sliderInfo.slider.centerX;
        const startY = sliderInfo.slider.centerY;
        const endX = startX + dragDistance;

        await p.mouse.move(startX, startY);
        await p.waitForTimeout(150);
        await p.mouse.down();
        await p.waitForTimeout(200);

        const steps = 18 + Math.floor(Math.random() * 8);
        for (let i = 1; i <= steps; i++) {
          const progress = i / steps;
          const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          const x = startX + dragDistance * eased + (Math.random() - 0.5) * 2;
          const y = startY + (Math.random() - 0.5) * 2;
          await p.mouse.move(x, y);
          await p.waitForTimeout(10 + Math.random() * 20);
        }
        await p.mouse.move(endX, startY);
        await p.waitForTimeout(150);
        await p.mouse.up();
        await p.waitForTimeout(2000);

        results.push(`GeeTest: slider dragged ${dragDistance}px — outcome unconfirmed, take a screenshot to verify the gap was matched`);
      } else {
        results.push('GeeTest slider detected but gap position could not be auto-detected');
      }
    } catch (e: any) {
      results.push(`GeeTest slider: auto-solve attempted (${e.message?.slice(0, 80)})`);
    }
  }

  if (recaptchaBframe) {
    const gridResult = await analyzeImageChallenge(p, recaptchaBframe, 'recaptcha');
    results.push('reCAPTCHA image challenge detected — grid analysis:');
    results.push(gridResult);
  }

  const funcaptchaFrame = frames.find(f => f.url().includes('funcaptcha') || f.url().includes('arkoselabs'));
  if (funcaptchaFrame) {
    results.push('FunCaptcha detected — screenshotting puzzle...');
    try {
      const fcScreenshotPath = join(homedir(), '.aurix-funcaptcha-puzzle.png');
      await funcaptchaFrame.locator('body').screenshot({ path: fcScreenshotPath }).catch(() => p.screenshot({ path: fcScreenshotPath }));
      results.push(`Puzzle screenshot: ${fcScreenshotPath}`);
      results.push('Analyze the puzzle image and determine the correct answer, then use click/evaluate to solve it.');
    } catch {
      results.push('REQUIRES_VISION: FunCaptcha detected — needs image analysis to solve');
    }
  }

  return results;
}

export async function analyzeImageChallenge(page: any, frame: any, provider: string): Promise<string> {
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
  const gridSize = tiles.length <= 9 ? '3x3' : tiles.length <= 16 ? '4x4' : `${tiles.length}-tile`;
  results.push(`Grid: ${gridSize} (${tiles.length} tiles found, valid indices: 0-${tiles.length - 1})`);
  setLastGridAnalyzeTime(Date.now());

  try {
    const home = homedir();
    for (const f of readdirSync(home)) {
      if (/^\.aurix-tile-(\d+|after-\d+)\.png$/.test(f)) {
        try { unlinkSync(join(home, f)); } catch {}
      }
    }
  } catch {}

  const screenshotPath = join(homedir(), '.aurix-captcha-grid.png');
  try {
    const gridEl = frame.locator('.rc-imageselect-table-33, .rc-imageselect-table-44, .task, .challenge-view, .geetest_panel, table').first();
    if (await gridEl.count() > 0) {
      await gridEl.screenshot({ path: screenshotPath });
    } else {
      await frame.locator('html').screenshot({ path: screenshotPath });
    }
    const buf = readFileSync(screenshotPath);
    if (buf.length < 2000) {
      try { await page.screenshot({ path: screenshotPath }); } catch {}
    }
  } catch {
    try { await page.screenshot({ path: screenshotPath }); } catch {}
  }
  results.push(`Grid screenshot: ${screenshotPath}`);

  try {
    const tileDataUrls = await frame.evaluate(async (count: number) => {
      const tables = document.querySelectorAll('table');
      let cells: Element[] = [];
      for (const table of tables) {
        const tds = Array.from(table.querySelectorAll('td'));
        if (tds.length >= count) { cells = tds; break; }
        if (tds.length >= 4 && tds.length > cells.length) cells = tds;
      }
      if (cells.length === 0) return [];
      const firstImg = cells[0].querySelector('img') as HTMLImageElement | null;
      const isSprite = firstImg && firstImg.naturalWidth > 0 &&
        cells.every(c => {
          const img = c.querySelector('img') as HTMLImageElement | null;
          return img && img.src === firstImg.src;
        });
      const cols = cells.length <= 9 ? 3 : 4;
      const results: string[] = [];
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
              const canvas = document.createElement('canvas');
              canvas.width = Math.round(sw);
              canvas.height = Math.round(sh);
              const ctx = canvas.getContext('2d');
              if (ctx) { ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh); results.push(canvas.toDataURL('image/png')); continue; }
            } catch {}
          } else {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext('2d');
              if (ctx) { ctx.drawImage(img, 0, 0); results.push(canvas.toDataURL('image/png')); continue; }
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
      return results;
    }, tiles.length);

    for (let i = 0; i < tiles.length; i++) {
      const tilePath = join(homedir(), `.aurix-tile-${i}.png`);
      try {
        if (i < tileDataUrls.length && tileDataUrls[i]) {
          const b64 = tileDataUrls[i].split(',')[1];
          if (b64) {
            writeFileSync(tilePath, Buffer.from(b64, 'base64'));
            results.push(`  Tile ${i}: ${tilePath}`);
            continue;
          }
        }
        await tiles[i].screenshot({ path: tilePath });
        results.push(`  Tile ${i}: ${tilePath}`);
      } catch {
        results.push(`  Tile ${i}: (screenshot failed)`);
      }
    }
  } catch {
    for (let i = 0; i < tiles.length; i++) {
      const tilePath = join(homedir(), `.aurix-tile-${i}.png`);
      try {
        await tiles[i].screenshot({ path: tilePath });
        results.push(`  Tile ${i}: ${tilePath}`);
      } catch {
        results.push(`  Tile ${i}: (screenshot failed)`);
      }
    }
  }

  const isRecaptcha = provider === 'recaptcha';
  const selectedClass = isRecaptcha ? '.rc-imageselect-dynamic-selected' : '.task-image.selected, .task .selected';
  const selectedCount = await frame.locator(selectedClass).count();
  if (selectedCount > 0) {
    results.push(`Already selected: ${selectedCount} tile(s)`);
  }

  results.push('');
  results.push('=== IMAGE SELECTION STEPS ===');
  results.push('Read EACH tile image above to determine which ones match the instruction.');
  results.push('Then execute these actions IN ORDER:');
  results.push('');
  results.push('Step 1: For each matching tile, call: browser action="click-tile" value="<index>"');
  results.push('  Example: if tiles 0, 3, and 5 match → click-tile 0, then click-tile 3, then click-tile 5');
  if (provider === 'recaptcha') {
    results.push('  IMPORTANT: After clicking a tile, a NEW tile replaces it. Read the new tile screenshot to check if it also matches.');
  }
  results.push('Step 2: After clicking ALL matching tiles, call: browser action="captcha-verify"');
  results.push('Step 3: If the grid refreshes with new tiles, call captcha-grid again and repeat from Step 1');
  results.push('');
  results.push('Do NOT skip any step. Start by reading the tile images now.');

  return results.join('\n');
}
