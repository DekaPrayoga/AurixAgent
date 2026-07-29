import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

export type AliyunGapCandidate = {
  gapX: number;
  confidence: number;
  scale?: number;
};

export type AliyunOpenCvResult = {
  ok: boolean;
  method?: string;
  backgroundWidth?: number;
  backgroundHeight?: number;
  pieceX?: number;
  pieceWidth?: number;
  candidates?: AliyunGapCandidate[];
  error?: string;
};

let availabilityPromise: Promise<{ python?: string; helper?: string; error?: string }> | undefined;

function helperCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    process.env.AURIX_ALIYUN_OPENCV_HELPER || '',
    resolve(process.cwd(), 'scripts/aliyun-gap-opencv.py'),
    resolve(here, '../../../scripts/aliyun-gap-opencv.py'),
    resolve(here, '../../scripts/aliyun-gap-opencv.py'),
    join(process.cwd(), 'node_modules/aurix-ai/scripts/aliyun-gap-opencv.py'),
  ].filter(Boolean);
}

async function resolveRuntime(): Promise<{ python?: string; helper?: string; error?: string }> {
  const helper = helperCandidates().find(existsSync);
  if (!helper) return { error: 'Aliyun OpenCV helper is not installed' };
  const candidates = [process.env.AURIX_PYTHON, 'python3', 'python'].filter(Boolean) as string[];
  for (const python of candidates) {
    try {
      await execFileAsync(python, ['-c', 'import cv2,numpy'], {
        timeout: 1500,
        maxBuffer: 128 * 1024,
        env: { ...process.env, OMP_NUM_THREADS: '2' },
      });
      return { python, helper };
    } catch {}
  }
  return { error: 'Python OpenCV and NumPy are unavailable' };
}

export function resetAliyunOpenCvAvailabilityForTest(): void {
  availabilityPromise = undefined;
}

function validateResult(value: unknown): AliyunOpenCvResult {
  if (!value || typeof value !== 'object') throw new Error('OpenCV helper returned invalid JSON');
  const raw = value as Record<string, unknown>;
  if (raw.ok !== true) throw new Error(String(raw.error || 'OpenCV helper failed'));
  const width = Number(raw.backgroundWidth);
  const height = Number(raw.backgroundHeight);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('OpenCV helper returned invalid dimensions');
  }
  if (!Array.isArray(raw.candidates) || raw.candidates.length === 0) {
    throw new Error('OpenCV helper returned no candidates');
  }
  const candidates = raw.candidates.map((candidate) => {
    const item = candidate as Record<string, unknown>;
    const gapX = Number(item.gapX);
    const confidence = Number(item.confidence);
    const scale = item.scale === undefined ? undefined : Number(item.scale);
    if (!Number.isFinite(gapX) || gapX < 0 || gapX >= width) throw new Error('OpenCV helper returned invalid gap coordinate');
    if (!Number.isFinite(confidence) || confidence < -1 || confidence > 1) throw new Error('OpenCV helper returned invalid confidence');
    return { gapX, confidence, ...(Number.isFinite(scale) ? { scale } : {}) };
  });
  candidates.sort((a, b) => b.confidence - a.confidence);
  return {
    ok: true,
    method: String(raw.method || 'opencv'),
    backgroundWidth: width,
    backgroundHeight: height,
    pieceX: Number(raw.pieceX || 0),
    pieceWidth: Number(raw.pieceWidth || 0),
    candidates,
  };
}

export async function detectAliyunGapOpenCv(
  backgroundPath: string,
  piecePath: string,
  maxCandidates = 5,
  timeoutMs = 10_000,
  geometry?: { pieceTop: number; pieceWidth: number; pieceHeight: number; renderedBackgroundWidth: number; renderedBackgroundHeight: number }
): Promise<AliyunOpenCvResult> {
  availabilityPromise ||= resolveRuntime();
  const runtime = await availabilityPromise;
  if (!runtime.python || !runtime.helper) return { ok: false, error: runtime.error };
  try {
    const args = [runtime.helper, '--background', backgroundPath, '--piece', piecePath, '--max-candidates', String(Math.max(1, Math.min(10, maxCandidates)))];
    if (geometry) {
      args.push(
        '--piece-top', String(geometry.pieceTop),
        '--piece-width', String(geometry.pieceWidth),
        '--piece-height', String(geometry.pieceHeight),
        '--rendered-background-width', String(geometry.renderedBackgroundWidth),
        '--rendered-background-height', String(geometry.renderedBackgroundHeight)
      );
    }
    const { stdout } = await execFileAsync(
      runtime.python,
      args,
      {
        timeout: Math.max(100, Math.min(10_000, timeoutMs)),
        maxBuffer: 1024 * 1024,
        env: { ...process.env, OMP_NUM_THREADS: '2' },
      }
    );
    return validateResult(JSON.parse(stdout.trim()));
  } catch (error: any) {
    return { ok: false, error: String(error?.stderr || error?.message || error).trim().slice(0, 500) };
  }
}

export function scaleAliyunGapCoordinate(
  gapX: number,
  sourceWidth: number,
  renderedWidth: number
): number {
  if (!Number.isFinite(gapX) || !Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(renderedWidth) || renderedWidth <= 0) {
    throw new Error('Invalid Aliyun coordinate scaling input');
  }
  return gapX * (renderedWidth / sourceWidth);
}
