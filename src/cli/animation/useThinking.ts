import { useEffect, useState, useRef } from 'react';

const FRAMES_GROW = [
  '*',
  '**',
  '***',
  '****',
  '*****',
  '******',
  '*******',
  '********',
];

const FRAMES_SHRINK = [
  '********',
  '*******',
  '******',
  '*****',
  '****',
  '***',
  '**',
  '*',
];

const FULL_CYCLE = [...FRAMES_GROW, ...FRAMES_SHRINK];

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
