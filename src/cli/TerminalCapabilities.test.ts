// @ts-ignore Bun injects this module in the test runner; production typecheck excludes its ambient types.
import { describe, expect, test } from 'bun:test';
import { detectTerminalCapabilities, statusGlyphs } from './TerminalCapabilities.js';

describe('terminal capabilities', () => {
  test('honors NO_COLOR and animation opt-out', () => {
    const caps = detectTerminalCapabilities({ TERM: 'xterm-256color', NO_COLOR: '1', AURIX_NO_ANIMATION: '1' }, 'linux', true);
    expect(caps.color).toBe(false);
    expect(caps.animation).toBe(false);
    expect(caps.unicode).toBe(true);
  });

  test('uses conservative Windows Unicode detection', () => {
    expect(detectTerminalCapabilities({}, 'win32', true).unicode).toBe(false);
    expect(detectTerminalCapabilities({ WT_SESSION: '1' }, 'win32', true).unicode).toBe(true);
  });

  test('provides textual status fallback', () => {
    const glyphs = statusGlyphs({ color: false, unicode: false, animation: false, interactive: true });
    expect(glyphs.success).toBe('[ok]');
    expect(glyphs.error).toBe('[error]');
  });
});
