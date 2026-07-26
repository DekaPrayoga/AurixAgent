import { useEffect, useState } from 'react';
import { detectTerminalCapabilities } from '../TerminalCapabilities.js';

const CHARS_UNICODE = ['·', '✢', '*', '✶', '✻', '✽'];
const CHARS_ASCII = ['.', '*', '**', '***', '****', '***', '**', '*'];
const CHARS = process.platform === 'win32' ? CHARS_ASCII : CHARS_UNICODE;
const FULL_CYCLE = process.platform === 'win32' ? CHARS : [...CHARS, ...[...CHARS].reverse()];

const CAPS = detectTerminalCapabilities();

/**
 * One timer per interval, shared by every subscriber.
 *
 * Each animated component used to own its own setInterval, so N indicators on screen meant
 * N unsynchronised clocks — they drifted visibly apart and multiplied wakeups. Subscribers
 * on the same interval now advance on the same tick and the timer stops when the last one
 * leaves.
 */
const clocks = new Map<number, { timer: ReturnType<typeof setInterval>; subs: Set<() => void> }>();

function subscribe(intervalMs: number, onTick: () => void): () => void {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    const subs = new Set<() => void>();
    const timer = setInterval(() => {
      for (const fn of subs) fn();
    }, intervalMs);
    timer.unref?.();
    clock = { timer, subs };
    clocks.set(intervalMs, clock);
  }
  clock.subs.add(onTick);
  return () => {
    const current = clocks.get(intervalMs);
    if (!current) return;
    current.subs.delete(onTick);
    if (current.subs.size === 0) {
      clearInterval(current.timer);
      clocks.delete(intervalMs);
    }
  };
}

/** Monotonic tick for animated components. Returns 0 and never starts a timer when inactive. */
export function useAnimationTick(active: boolean, intervalMs: number): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active || !CAPS.animation) return;
    return subscribe(intervalMs, () => setTick((t) => t + 1));
  }, [active, intervalMs]);

  return active ? tick : 0;
}

/** Pulsing glyph shown while the agent is thinking. */
export function useThinkingAnimation(active: boolean, intervalMs: number = 120): string {
  const tick = useAnimationTick(active, intervalMs);
  if (!active) return '';
  // Without animation the glyph would flicker between frames on every unrelated re-render,
  // so pin it to the densest one and let it sit still.
  if (!CAPS.animation) return CHARS[CHARS.length - 1];
  return FULL_CYCLE[tick % FULL_CYCLE.length];
}

const SCAN_ACTIVE = process.platform === 'win32' ? '#' : '■';
const SCAN_TRAIL = process.platform === 'win32' ? '=' : '▪';
const SCAN_IDLE = process.platform === 'win32' ? '-' : '·';

/**
 * A block that sweeps back and forth with a short trail behind it, pausing at each end.
 * Reads as sustained effort rather than an undifferentiated twirl, which is the point:
 * a spinner that looks identical at second 1 and second 90 tells you nothing.
 */
export function useScanner(active: boolean, width = 7, intervalMs = 80): string {
  const tick = useAnimationTick(active, intervalMs);
  if (!active) return '';
  if (!CAPS.animation) return SCAN_ACTIVE + SCAN_IDLE.repeat(Math.max(0, width - 1));

  const hold = 3;
  const span = width - 1;
  const cycle = (span + hold) * 2;
  const phase = tick % cycle;
  // Clamp inside the hold window so the head parks at the edge instead of bouncing instantly.
  const head =
    phase <= span + hold
      ? Math.min(span, phase)
      : Math.max(0, span - (phase - span - hold));
  const forward = phase <= span + hold;

  let out = '';
  for (let i = 0; i < width; i++) {
    const behind = forward ? head - i : i - head;
    if (i === head) out += SCAN_ACTIVE;
    else if (behind === 1) out += SCAN_TRAIL;
    else out += SCAN_IDLE;
  }
  return out;
}
