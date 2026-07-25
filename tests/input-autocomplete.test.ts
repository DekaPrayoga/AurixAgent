import { describe, expect, test } from 'bun:test';
import type { SlashCommand } from '../src/cli/commands.js';
import { resolveCommandCompletion, resolveFileCompletion } from '../src/cli/InputBox.js';

const commands: SlashCommand[] = [
  { name: 'addskills', description: 'Add skills', group: 'skills' },
  { name: 'agents', description: 'Show agents', group: 'agent' },
  { name: 'exit', description: 'Exit Aurix', group: 'session' },
];

describe('resolveCommandCompletion', () => {
  test('uses the current /exit query instead of the stale first command', () => {
    expect(resolveCommandCompletion(commands, '/exit', 0)).toBe('/exit ');
  });

  test('uses the current /agen query instead of the stale first command', () => {
    expect(resolveCommandCompletion(commands, '/agen', 0)).toBe('/agents ');
  });

  test('returns null when slash suggestions are not active', () => {
    expect(resolveCommandCompletion(commands, 'hello', 0)).toBeNull();
  });
});

describe('resolveFileCompletion', () => {
  test('uses the current file query instead of stale suggestions', () => {
    expect(
      resolveFileCompletion('see @src/cli/In', ['src/cli/InputBox.tsx'], 0)
    ).toBe('see @src/cli/InputBox.tsx ');
  });

  test('returns null when file suggestions are not active', () => {
    expect(resolveFileCompletion('hello', ['src/cli/InputBox.tsx'], 0)).toBeNull();
  });
});
