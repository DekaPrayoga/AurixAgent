import { afterAll, describe, expect, test } from 'bun:test';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import sharp from 'sharp';
import {
  detectAliyunGapOpenCv,
  scaleAliyunGapCoordinate,
} from '../src/tools/captcha/AliyunOpenCvDetector.js';

const execFileAsync = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'aurix-aliyun-opencv-test-'));
afterAll(async () => rm(directory, { recursive: true, force: true }));

const width = 300;
const height = 150;
const pieceWidth = 40;
const pieceHeight = 46;
const pieceTop = 50;

async function createFixture(gapX: number): Promise<{ background: string; piece: string }> {
  const pieceSvg = Buffer.from(`<svg width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="rgba(0,0,0,0)"/><path d="M 0 ${pieceTop} h ${pieceWidth} v 12 q 12 8 0 16 v 18 h -${pieceWidth} z" fill="white"/></svg>`);
  const backgroundSvg = Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#6688aa"/><path d="M ${gapX} ${pieceTop} h ${pieceWidth} v 12 q 12 8 0 16 v 18 h -${pieceWidth} z" fill="#1b2733"/><line x1="230" y1="0" x2="230" y2="${height}" stroke="#ddd" stroke-width="2"/></svg>`);
  const background = join(directory, 'background.png');
  const piece = join(directory, 'piece.png');
  await sharp(backgroundSvg).png().toFile(background);
  await sharp(pieceSvg).png().toFile(piece);
  return { background, piece };
}

describe('Aliyun OpenCV bridge', () => {
  test('scales coordinates into rendered width', () => {
    expect(scaleAliyunGapCoordinate(150, 300, 240)).toBe(120);
    expect(() => scaleAliyunGapCoordinate(1, 0, 100)).toThrow();
  });

  test('detects a synthetic puzzle gap', async () => {
    const fixture = await createFixture(162);
    const result = await detectAliyunGapOpenCv(fixture.background, fixture.piece, 5, 10_000, {
      pieceTop,
      pieceWidth,
      pieceHeight,
      renderedBackgroundWidth: width,
      renderedBackgroundHeight: height,
    });
    expect(result.ok).toBe(true);
    expect(result.candidates?.length).toBeGreaterThan(0);
    expect(Math.abs((result.candidates?.[0].gapX || 0) - 162)).toBeLessThanOrEqual(8);
    const confidences = result.candidates?.map((item) => item.confidence) || [];
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
  });

  test('helper fails cleanly for missing images', async () => {
    await expect(execFileAsync('python3', [
      'scripts/aliyun-gap-opencv.py',
      '--background', join(directory, 'missing.png'),
      '--piece', join(directory, 'missing-piece.png'),
    ])).rejects.toBeDefined();
  });
});
