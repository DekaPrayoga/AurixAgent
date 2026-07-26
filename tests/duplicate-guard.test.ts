import { describe, expect, test } from 'bun:test';
import { createHash } from 'crypto';

const OBSERVING_BROWSER_ACTIONS = new Set([
  'screenshot',
  'snapshot',
  'state',
  'evaluate',
  'detect-captcha',
  'captcha-grid',
  'slider-analyze',
]);

type Call = { name: string; arguments?: Record<string, unknown> };

function makeGuard(maxRecent = 8) {
  const recent: string[] = [];
  const sigOf = (call: Call) =>
    `${call.name}:${createHash('sha1').update(JSON.stringify(call.arguments || {})).digest('hex').slice(0, 12)}`;

  const invalidate = (call: Call) => {
    if (call.name !== 'browser') return;
    const action = String(call.arguments?.action || '').toLowerCase();
    if (!action || OBSERVING_BROWSER_ACTIONS.has(action)) return;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i].startsWith('browser:')) recent.splice(i, 1);
    }
  };

  return (call: Call): 'blocked' | 'ran' => {
    const sig = sigOf(call);
    if (recent.includes(sig)) return 'blocked';
    invalidate(call);
    recent.push(sig);
    if (recent.length > maxRecent) recent.shift();
    return 'ran';
  };
}

const signin = { name: 'browser', arguments: { action: 'signin-assist', value: '{"email":"a"}' } };
const navigate = { name: 'browser', arguments: { action: 'navigate', url: 'https://github.com/login' } };
const shot = { name: 'browser', arguments: { action: 'screenshot' } };

describe('duplicate tool-call guard', () => {
  test('retrying an action after the page moved is allowed', () => {
    const guard = makeGuard();
    expect(guard(signin)).toBe('ran');
    expect(guard(navigate)).toBe('ran');
    expect(guard(signin)).toBe('ran');
  });

  test('the same action twice with nothing in between is still blocked', () => {
    const guard = makeGuard();
    expect(guard(signin)).toBe('ran');
    expect(guard(signin)).toBe('blocked');
  });

  test('a repeated navigation is still blocked', () => {
    const guard = makeGuard();
    expect(guard(navigate)).toBe('ran');
    expect(guard(navigate)).toBe('blocked');
  });

  test('observing the page does not license a repeat', () => {
    const guard = makeGuard();
    expect(guard(signin)).toBe('ran');
    expect(guard(shot)).toBe('ran');
    expect(guard(signin)).toBe('blocked');
  });

  test('a non-browser tool is unaffected by browser navigation', () => {
    const guard = makeGuard();
    const read = { name: 'read_file', arguments: { path: '/tmp/a' } };
    expect(guard(read)).toBe('ran');
    expect(guard(navigate)).toBe('ran');
    expect(guard(read)).toBe('blocked');
  });
});
