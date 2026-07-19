// @ts-ignore Bun injects this module in the test runner; production typecheck excludes its ambient types.
import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { detectInstallMethod } from './InstallDiagnostics.js';

describe('install diagnostics', () => {
  test('prefers a source checkout when .git exists', () => {
    const root = path.resolve('/tmp/aurix-source');
    const result = detectInstallMethod(root, {}, (file) => file === path.join(root, '.git'));
    expect(result.method).toBe('source');
    expect(result.updateCommand).toContain('git pull');
  });

  test('uses package-manager user agent', () => {
    expect(detectInstallMethod('/opt/aurix', { npm_config_user_agent: 'pnpm/9.0.0' }, () => false).method).toBe('pnpm');
    expect(detectInstallMethod('/opt/aurix', { npm_config_user_agent: 'bun/1.2.0' }, () => false).method).toBe('bun');
  });

  test('infers npm global installs from node_modules path', () => {
    const result = detectInstallMethod('/usr/local/lib/node_modules/aurix-ai', {}, () => false);
    expect(result.method).toBe('npm');
    expect(result.updateCommand).toBe('npm install -g aurix-ai@latest');
  });
});
