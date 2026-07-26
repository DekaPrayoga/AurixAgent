import { describe, expect, test } from 'bun:test';
import { recoveryMessages, recoveryToolNames } from '../src/agent/EmptyResponseRecovery.js';
import type { Message } from '../src/providers/index.js';

const base: Message[] = [
  { role: 'system', content: 'system prompt' },
  { role: 'user', content: 'ayo login langsung aja gass' },
];

describe('empty-response recovery', () => {
  test('the retry nudge is a system message, not a fake user turn', () => {
    const out = recoveryMessages(base, 1);
    const added = out[out.length - 1];
    expect(added.role).toBe('system');
    expect(added.content).not.toContain('[System]');
    expect(out.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  test('nothing is appended on the first attempt', () => {
    expect(recoveryMessages(base, 0)).toHaveLength(base.length);
    expect(recoveryToolNames('anything', 0)).toEqual([]);
  });

  test('a login request reaches the browser tools on retry', () => {
    for (const text of [
      'ayo login langsung aja gass',
      'tolong sign in ke dashboard',
      'daftar akun baru',
      'buka websitenya',
      'masuk ke akun gue',
    ]) {
      expect(recoveryToolNames(text, 1)).toContain('browser');
    }
  });

  test('a local-work request reaches the file and terminal tools on retry', () => {
    for (const text of [
      'jalanin test dong',
      'bikin script python',
      'hapus file itu',
      'baca config nya',
      'run the build',
    ]) {
      const names = recoveryToolNames(text, 1);
      expect(names).toContain('terminal');
      expect(names).toContain('read_file');
    }
  });

  test('an unrecognised request still gets the full core set, never an empty list', () => {
    const names = recoveryToolNames('zzz qqq unknown phrasing', 1);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('browser');
    expect(names).toContain('terminal');
  });
});
