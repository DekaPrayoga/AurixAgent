import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig } from '../../agent/Config.js';
import { transcribeAudioCaptchaLocal, transcribeAudioCaptchaWithGroq } from '../AudioCaptcha.js';

export async function checkAudioButton(frame: any): Promise<boolean> {
  try {
    const audioBtn = await frame
      .locator('#recaptcha-audio-button, .rc-button-audio, [aria-label*="audio" i]')
      .count();
    return audioBtn > 0;
  } catch {
    return false;
  }
}

export async function solveAudioCaptcha(
  page: any,
  frame: any
): Promise<{ success: boolean; transcription?: string }> {
  const _dbg = (msg: string) => console.log(`[audio-bypass] ${msg}`);

  try {
    // Step 0: Stealth behavior before clicking audio
    _dbg('Preparing stealth behavior...');
    const vp = page.viewportSize() || { width: 1200, height: 900 };

    // Random mouse movements (human-like)
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(
        vp.width * (0.1 + Math.random() * 0.8),
        vp.height * (0.1 + Math.random() * 0.8),
        { steps: 10 + Math.floor(Math.random() * 15) }
      );
      await page.waitForTimeout(300 + Math.random() * 700);
    }

    // Random pause (2-5 seconds) to look human
    await page.waitForTimeout(2000 + Math.random() * 3000);

    // Step 1: Click audio button with human-like approach
    _dbg('Moving to audio button...');
    const audioBtn = frame
      .locator('#recaptcha-audio-button, .rc-button-audio, [aria-label*="audio" i]')
      .first();
    if ((await audioBtn.count()) === 0) {
      _dbg('Audio button not found');
      return { success: false };
    }

    // Move mouse to button first, then click
    const btnBox = await audioBtn.boundingBox();
    if (btnBox) {
      await page.mouse.move(
        btnBox.x + btnBox.width * (0.3 + Math.random() * 0.4),
        btnBox.y + btnBox.height * (0.3 + Math.random() * 0.4),
        { steps: 15 + Math.floor(Math.random() * 10) }
      );
      await page.waitForTimeout(200 + Math.random() * 300);
    }

    _dbg('Clicking audio button...');
    await audioBtn.click({ timeout: 5000 });

    // Wait for audio challenge to load (with random delay)
    await page.waitForTimeout(3000 + Math.random() * 2000);

    // Step 2: Find audio source URL (with retries)
    _dbg('Looking for audio source...');
    let audioUrl: string | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      audioUrl = await frame.evaluate(() => {
        // Check for audio element
        const audio = document.querySelector('audio');
        if (audio && audio.src) return audio.src;

        // Check for source element inside audio
        const source = document.querySelector('audio source');
        if (source && (source as HTMLSourceElement).src) return (source as HTMLSourceElement).src;

        // Check for download link
        const downloadLink = document.querySelector(
          '.rc-audiochallenge-tdownloadlink a, a.rc-audiochallenge-tdownloadlink, a[href*="audio"]'
        );
        if (downloadLink) return (downloadLink as HTMLAnchorElement).href;

        // Check for any link with audio content
        const links = document.querySelectorAll('a[href]');
        for (const link of links) {
          const href = (link as HTMLAnchorElement).href;
          if (
            href.includes('audio') ||
            href.includes('.mp3') ||
            href.includes('.wav') ||
            href.includes('.ogg')
          ) {
            return href;
          }
        }

        // Check for iframe src that might contain audio
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
          const src = (iframe as HTMLIFrameElement).src;
          if (src && src.includes('audio')) return src;
        }

        return null;
      });

      if (audioUrl) break;

      _dbg(`Audio URL not found (attempt ${attempt + 1}/5), waiting...`);
      // Debug: log page content to understand what's there
      if (attempt === 2) {
        const pageInfo = await frame.evaluate(() => {
          return {
            bodyText: document.body?.innerText?.substring(0, 200) || '',
            audioElements: document.querySelectorAll('audio').length,
            links: Array.from(document.querySelectorAll('a'))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter((h) => h)
              .slice(0, 5),
            iframes: Array.from(document.querySelectorAll('iframe'))
              .map((f) => (f as HTMLIFrameElement).src)
              .slice(0, 3),
            classes: Array.from(document.querySelectorAll('[class]'))
              .slice(0, 10)
              .map((el) => el.className),
          };
        });
        _dbg(`Page debug: ${JSON.stringify(pageInfo).substring(0, 500)}`);
      }
      await page.waitForTimeout(2000);
    }

    if (!audioUrl) {
      _dbg('Audio URL not found');
      return { success: false };
    }
    _dbg(`Audio URL: ${audioUrl.substring(0, 100)}...`);

    // Step 3: Download audio file
    const audioPath = join(homedir(), '.aurix-audio-challenge.mp3');
    _dbg('Downloading audio...');

    // Use page to download (respects proxy)
    const audioData = await frame.evaluate(async (url: string) => {
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const reader = new FileReader();
        return new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    }, audioUrl);

    if (!audioData) {
      _dbg('Failed to download audio');
      return { success: false };
    }

    // Save audio file
    const base64Data = audioData.split(',')[1];
    writeFileSync(audioPath, Buffer.from(base64Data, 'base64'));
    _dbg(`Audio saved: ${audioPath}`);

    // Step 4: Transcribe through the dedicated audio captcha tools.
    const config = loadConfig();
    const useGroq = config.useGroqAudio !== false && Boolean(config.groqApiKey);
    _dbg(
      useGroq
        ? 'Transcribing with audio_captcha (Groq Whisper Large)...'
        : 'Transcribing with audio_captcha_local...'
    );

    const toolOutput = useGroq
      ? await transcribeAudioCaptchaWithGroq({ file_path: audioPath, language: 'en' })
      : await transcribeAudioCaptchaLocal({ file_path: audioPath, language: 'en' });
    _dbg(toolOutput.split('\n').slice(0, 4).join(' | '));
    const transcription = toolOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line && !line.startsWith('[') && !line.startsWith('source:') && !line.startsWith('model:')
      )
      .join(' ')
      .trim();

    // Cleanup audio file
    try {
      unlinkSync(audioPath);
    } catch {}

    if (!transcription) {
      _dbg('Transcription failed');
      return { success: false };
    }

    _dbg(`Transcription: "${transcription}"`);

    // Step 5: Type transcription into response field
    _dbg('Typing transcription...');
    const inputField = frame
      .locator(
        '#audio-response, input[name="audio_response"], input[placeholder*="audio" i], input[type="text"]'
      )
      .first();
    if ((await inputField.count()) === 0) {
      _dbg('Input field not found');
      return { success: false, transcription };
    }

    await inputField.click();
    await inputField.fill(transcription);
    await page.waitForTimeout(500);

    // Step 6: Click verify button
    _dbg('Clicking verify...');
    const verifyBtn = frame
      .locator('#recaptcha-verify-button, .rc-button-submit, button[type="submit"]')
      .first();
    if ((await verifyBtn.count()) > 0) {
      await verifyBtn.click({ timeout: 5000 });
      await page.waitForTimeout(3000);

      // Check result
      const verified = await page.evaluate(() => {
        const el = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement;
        return !!(el && el.value && el.value.length > 10);
      });

      _dbg(verified ? 'VERIFIED!' : 'Verification failed');
      return { success: verified, transcription };
    }

    return { success: false, transcription };
  } catch (e: any) {
    _dbg(`Error: ${e.message}`);
    return { success: false };
  }
}
