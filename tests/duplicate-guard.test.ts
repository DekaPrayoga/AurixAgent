import { describe, expect, test } from 'bun:test';
import { createHash } from 'crypto';

type Call = { name: string; arguments?: Record<string, unknown> };
type Verdict = 'ok' | 'block' | 'halt';

const REPEAT_BLOCK_AT = 3;
const REPEAT_HALT_AT = 6;

function makeGuard() {
  let repeatStreak = 0;
  let lastSignature: string | undefined;
  const sigOf = (call: Call) =>
    `${call.name}:${createHash('sha1').update(JSON.stringify(call.arguments || {})).digest('hex').slice(0, 12)}`;

  const verdict = (sig: string): Verdict => {
    const streak = sig === lastSignature ? repeatStreak + 1 : 1;
    if (streak >= REPEAT_HALT_AT) return 'halt';
    if (streak >= REPEAT_BLOCK_AT) return 'block';
    return 'ok';
  };

  return (call: Call): Verdict => {
    const sig = sigOf(call);
    const v = verdict(sig);
    repeatStreak = sig === lastSignature ? repeatStreak + 1 : 1;
    lastSignature = sig;
    return v;
  };
}

const signin = { name: 'browser', arguments: { action: 'signin-assist', value: '{"email":"a"}' } };
const navigate = { name: 'browser', arguments: { action: 'navigate', url: 'https://github.com/login' } };
const read = { name: 'read_file', arguments: { path: '/tmp/a' } };

describe('repeated tool-call guard', () => {
  test('retrying after the page moved is allowed', () => {
    const guard = makeGuard();
    expect(guard(signin)).toBe('ok');
    expect(guard(navigate)).toBe('ok');
    expect(guard(signin)).toBe('ok');
  });

  test('one immediate retry is allowed, because transient failures are normal', () => {
    const guard = makeGuard();
    expect(guard(signin)).toBe('ok');
    expect(guard(signin)).toBe('ok');
  });

  test('the third identical call in a row is refused', () => {
    const guard = makeGuard();
    guard(signin);
    guard(signin);
    expect(guard(signin)).toBe('block');
  });

  test('a refusal does not end the turn until the sixth attempt', () => {
    const guard = makeGuard();
    const verdicts = Array.from({ length: 6 }, () => guard(signin));
    expect(verdicts.slice(0, 2)).toEqual(['ok', 'ok']);
    expect(verdicts.slice(2, 5)).toEqual(['block', 'block', 'block']);
    expect(verdicts[5]).toBe('halt');
  });

  test('anything in between resets the streak', () => {
    const guard = makeGuard();
    guard(signin);
    guard(signin);
    expect(guard(read)).toBe('ok');
    expect(guard(signin)).toBe('ok');
    expect(guard(signin)).toBe('ok');
  });

  test('alternating between two calls never blocks, and the iteration cap is the backstop', () => {
    const guard = makeGuard();
    for (let i = 0; i < 10; i++) {
      expect(guard(signin)).toBe('ok');
      expect(guard(navigate)).toBe('ok');
    }
  });
});
