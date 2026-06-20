import { useEffect, useState, useRef } from 'react';

const CHARS_UNICODE = ['·', '✢', '*', '✶', '✻', '✽'];
const CHARS_ASCII = ['.', '*', '**', '***', '****', '***', '**', '*'];
const CHARS = process.platform === 'win32' ? CHARS_ASCII : CHARS_UNICODE;
const FULL_CYCLE = process.platform === 'win32' ? CHARS : [...CHARS, ...[...CHARS].reverse()];

export function useThinkingAnimation(active: boolean, intervalMs: number = 120): string {
  const [frame, setFrame] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      intervalRef.current = setInterval(() => {
        setFrame(f => (f + 1) % FULL_CYCLE.length);
      }, intervalMs);
    } else {
      setFrame(0);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [active, intervalMs]);

  if (!active) return '';
  return FULL_CYCLE[frame];
}
