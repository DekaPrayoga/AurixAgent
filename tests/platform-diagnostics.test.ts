import { describe, expect, test } from 'bun:test';
import { terminalDiagnostics } from '../src/cli/InstallDiagnostics.js';
import { DuplicateToolCallGuard } from '../src/agent/DuplicateToolCallGuard.js';

describe('cross-platform diagnostics', () => {
  test('reports Windows facts without Linux assumptions', () => {
    const output = terminalDiagnostics({ WT_SESSION: '1', COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }, 'win32', 'x64').join('\n');
    expect(output).toContain('Platform: win32 x64');
    expect(output).toContain('Windows guard');
    expect(output).toContain('PowerShell/OSC52');
    expect(output).toContain('Command guidance: Windows');
  });

  test('reports macOS facts', () => {
    const output = terminalDiagnostics({ TERM_PROGRAM: 'Apple_Terminal', SHELL: '/bin/zsh' }, 'darwin', 'arm64').join('\n');
    expect(output).toContain('Platform: darwin arm64');
    expect(output).toContain('Desktop: macOS');
    expect(output).toContain('pbcopy/OSC52');
  });

  test('reports Linux display facts', () => {
    const output = terminalDiagnostics({ TERM: 'xterm', SHELL: '/bin/bash', WAYLAND_DISPLAY: 'wayland-0' }, 'linux', 'x64').join('\n');
    expect(output).toContain('Platform: linux x64');
    expect(output).toContain('Desktop: Linux');
    expect(output).toContain('display=Wayland');
  });
});

describe('duplicate tool diagnostics', () => {
  test('exposes the actual streak and verdict', () => {
    const guard = new DuplicateToolCallGuard();
    const call = { name: 'terminal', arguments: { command: 'dir' } };
    guard.check(call);
    guard.check(call);
    expect(guard.snapshot()).toMatchObject({ toolName: 'terminal', streak: 2, verdict: 'ok' });
    expect(guard.check(call)).toBe('block');
    expect(guard.snapshot()).toMatchObject({ streak: 3, verdict: 'block' });
    guard.check(call);
    guard.check(call);
    expect(guard.check(call)).toBe('halt');
    expect(guard.snapshot()).toMatchObject({ streak: 6, verdict: 'halt' });
  });
});
