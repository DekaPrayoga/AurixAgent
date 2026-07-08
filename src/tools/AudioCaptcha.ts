import { execFile } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import type { Tool } from './Registry.js';
import { loadConfig } from '../agent/Config.js';

const GROQ_AUDIO_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_WHISPER_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_AUDIO_NAME = 'audio-captcha.mp3';

interface AudioInput {
  path: string;
  cleanupDir?: string;
  source: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function pickAudioInput(args: Record<string, unknown>): {
  url: string;
  filePath: string;
  language: string;
} {
  const url = asString(args.url || args.audio_url || args.audioUrl);
  const filePath = asString(args.file_path || args.path || args.filePath);
  const language = asString(args.language) || 'en';
  return { url, filePath, language };
}

async function resolveAudioInput(args: Record<string, unknown>): Promise<AudioInput> {
  const { url, filePath } = pickAudioInput(args);
  const target = url || filePath;
  if (!target) throw new Error('Provide audio_url/url or file_path/path.');

  if (isUrl(target)) {
    const dir = mkdtempSync(join(tmpdir(), 'aurix-audio-captcha-'));
    const path = join(dir, DEFAULT_AUDIO_NAME);
    const resp = await fetch(target, {
      headers: {
        'user-agent': 'AurixAgent/AudioCaptcha',
        accept: 'audio/*,*/*;q=0.8',
      },
    });
    if (!resp.ok) throw new Error(`Audio download failed: HTTP ${resp.status} ${resp.statusText}`);
    const bytes = Buffer.from(await resp.arrayBuffer());
    if (bytes.length === 0) throw new Error('Audio download returned an empty file.');
    writeFileSync(path, bytes);
    return { path, cleanupDir: dir, source: target };
  }

  if (!existsSync(target)) throw new Error(`Audio file not found: ${target}`);
  return { path: target, source: target };
}

function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*(?:music|silence|noise|inaudible)[^\]]*\]/gi, ' ')
    .replace(/\([^)]*(?:music|silence|noise|inaudible)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function outputTranscript(kind: string, source: string, model: string, transcript: string): string {
  const cleaned = cleanTranscript(transcript);
  if (!cleaned) return `[ERROR] ${kind} transcription returned empty text.`;
  return [
    `[OK] ${kind} transcription complete`,
    `source: ${source}`,
    `model: ${model}`,
    '',
    cleaned,
  ].join('\n');
}

function cleanup(input: AudioInput): void {
  if (!input.cleanupDir) return;
  try {
    rmSync(input.cleanupDir, { recursive: true, force: true });
  } catch {}
}

export async function transcribeAudioCaptchaWithGroq(
  args: Record<string, unknown>
): Promise<string> {
  const config = loadConfig();
  const apiKey =
    asString(args.api_key || args.apiKey) || config.groqApiKey || process.env.GROQ_API_KEY || '';
  if (!apiKey) {
    return '[ERROR] Missing Groq API key. Set groqApiKey in ~/.aurix/config.yaml or GROQ_API_KEY.';
  }

  let input: AudioInput | undefined;
  try {
    input = await resolveAudioInput(args);
    const { language } = pickAudioInput(args);
    const audioBuffer = readFileSync(input.path);
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer]), basename(input.path) || DEFAULT_AUDIO_NAME);
    formData.append('model', GROQ_WHISPER_MODEL);
    formData.append('temperature', '0');
    formData.append('response_format', 'json');
    if (language) formData.append('language', language);

    const resp = await fetch(GROQ_AUDIO_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    const body = await resp.text();
    if (!resp.ok)
      return `[ERROR] Groq transcription failed: HTTP ${resp.status}\n${body.slice(0, 1000)}`;
    const data = JSON.parse(body) as { text?: string };
    return outputTranscript('audio_captcha', input.source, GROQ_WHISPER_MODEL, data.text || '');
  } catch (e: any) {
    return `[ERROR] audio_captcha failed: ${e.message}`;
  } finally {
    if (input) cleanup(input);
  }
}

function execFilePromise(
  command: string,
  args: string[],
  timeout: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) {
        const err = error as Error & { code?: number | string };
        reject(new Error(`${err.message}${stderr ? `\n${stderr}` : ''}`));
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export async function transcribeAudioCaptchaLocal(args: Record<string, unknown>): Promise<string> {
  let input: AudioInput | undefined;
  try {
    input = await resolveAudioInput(args);
    const { language } = pickAudioInput(args);
    const model = asString(args.model) || 'small';
    const dir = mkdtempSync(join(tmpdir(), 'aurix-whisper-output-'));
    try {
      await execFilePromise(
        'whisper',
        [
          input.path,
          '--model',
          model,
          '--language',
          language || 'en',
          '--temperature',
          '0',
          '--output_format',
          'txt',
          '--output_dir',
          dir,
        ],
        Number(args.timeout || 60000)
      );
      const txtPath = join(dir, `${basename(input.path).replace(/\.[^.]+$/, '')}.txt`);
      const fallbackTxtPath = join(dir, `${basename(input.path)}.txt`);
      const transcript = existsSync(txtPath)
        ? readFileSync(txtPath, 'utf-8')
        : existsSync(fallbackTxtPath)
          ? readFileSync(fallbackTxtPath, 'utf-8')
          : '';
      return outputTranscript(
        'audio_captcha_local',
        input.source,
        `local-whisper:${model}`,
        transcript
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (e: any) {
    return `[ERROR] audio_captcha_local failed: ${e.message}\nInstall/configure local whisper first, or use audio_captcha with groqApiKey.`;
  } finally {
    if (input) cleanup(input);
  }
}

export const audioCaptchaTool: Tool = {
  name: 'audio_captcha',
  description:
    'Transcribe an audio verification challenge using the configured Groq Whisper Large model. Use this for audio captcha URLs/files instead of terminal curl/whisper commands. Reads groqApiKey from ~/.aurix/config.yaml or GROQ_API_KEY.',
  parameters: {
    type: 'object',
    properties: {
      audio_url: { type: 'string', description: 'Audio challenge URL (mp3/wav/ogg). Alias: url.' },
      url: { type: 'string', description: 'Audio challenge URL.' },
      file_path: { type: 'string', description: 'Local audio file path. Alias: path.' },
      path: { type: 'string', description: 'Local audio file path.' },
      language: { type: 'string', description: 'Language code for Whisper, default en.' },
    },
  },
  execute: transcribeAudioCaptchaWithGroq,
};

export const audioCaptchaLocalTool: Tool = {
  name: 'audio_captcha_local',
  description:
    'Transcribe an audio verification challenge using the local whisper CLI only. Use this when the user explicitly wants local AI. Does not install packages.',
  parameters: {
    type: 'object',
    properties: {
      audio_url: { type: 'string', description: 'Audio challenge URL (mp3/wav/ogg). Alias: url.' },
      url: { type: 'string', description: 'Audio challenge URL.' },
      file_path: { type: 'string', description: 'Local audio file path. Alias: path.' },
      path: { type: 'string', description: 'Local audio file path.' },
      language: { type: 'string', description: 'Language code for Whisper, default en.' },
      model: { type: 'string', description: 'Local Whisper model name, default small.' },
      timeout: { type: 'number', description: 'Timeout in milliseconds, default 60000.' },
    },
  },
  execute: transcribeAudioCaptchaLocal,
};
