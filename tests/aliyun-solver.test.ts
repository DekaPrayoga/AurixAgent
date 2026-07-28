import { describe, expect, test } from 'bun:test';
import {
  aliyunPieceOffset,
  buildAliyunDragTrajectory,
  invertAliyunDragDistance,
} from '../src/tools/captcha/AliyunSolver.js';

describe('Aliyun quadratic slider geometry', () => {
  test('inversion reproduces the requested piece offset', () => {
    for (const offset of [20, 50, 100, 160, 240]) {
      const distance = invertAliyunDragDistance(offset);
      expect(Math.abs(aliyunPieceOffset(distance) - offset)).toBeLessThan(0.001);
    }
  });

  test('trajectory overshoots and returns to the exact target', () => {
    const start = { x: 10, y: 20 };
    const distance = 120;
    const points = buildAliyunDragTrajectory(start, distance, () => 0.5);
    const targetX = start.x + distance;
    expect(Math.max(...points.map((point) => point.x))).toBeGreaterThan(targetX + 5);
    expect(points.at(-1)).toEqual({ x: targetX, y: start.y });
  });

  test('trajectory vertical movement stays restrained', () => {
    const start = { x: 30, y: 40 };
    const points = buildAliyunDragTrajectory(start, 150, () => 0.5);
    expect(Math.max(...points.map((point) => Math.abs(point.y - start.y)))).toBeLessThanOrEqual(1.2);
    expect(points.length).toBe(53);
  });
});
