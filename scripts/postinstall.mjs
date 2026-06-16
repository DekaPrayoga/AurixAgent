#!/usr/bin/env node
// Runs automatically after `npm install` (postinstall hook).
// Fixes the two things that commonly break aurix on Windows:
//   1. @opentui/core-win32-x64 optional dependency sometimes gets skipped
//      (network glitch, --omit=optional, pnpm strict).
//   2. Bun runtime (preferred over Node because it has built-in FFI,
//      no --experimental-ffi flag needed).
// Safe to re-run; idempotent and skips when already satisfied.

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

function log(msg) { console.log(`[aurix postinstall] ${msg}`); }
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', ...opts }).status === 0;
}

// ─── 1. Ensure native OpenTUI binary is installed (Windows only) ───────────
if (process.platform === 'win32') {
  const pkgName = process.arch === 'arm64'
    ? '@opentui/core-win32-arm64'
    : '@opentui/core-win32-x64';
  const expected = join(projectRoot, 'node_modules', '@opentui', pkgName.replace('@opentui/', ''));

  if (existsSync(expected)) {
    log(`✓ ${pkgName} already installed`);
  } else {
    log(`⚠ ${pkgName} missing — installing (this optionalDependency is sometimes skipped by npm)`);
    // shell:true needed on Windows so `npm` resolves through npm.cmd
    const ok = run('npm', [
      'install', '--no-save', '--no-audit', '--no-fund', `${pkgName}@0.4.1`,
    ], { cwd: projectRoot, shell: true });
    if (!ok) log(`⚠ failed to install ${pkgName} — TUI may fail to start`);
    else log(`✓ ${pkgName} installed`);
  }
}

// ─── 2. Hint about Bun (don't auto-install on Windows — UAC prompt) ───────
try {
  execSync('bun --version', { stdio: 'ignore' });
  log('✓ Bun already installed');
} catch {
  if (process.platform === 'win32') {
    log('');
    log('⚠ Bun not found. Bun is RECOMMENDED on Windows because it has');
    log('  built-in FFI (no --experimental-ffi flag needed).');
    log('');
    log('  To install, run in PowerShell:');
    log('    powershell -c "irm bun.sh/install.ps1 | iex"');
    log('');
    log('  Skipping auto-install to avoid UAC prompts in non-interactive mode.');
  } else {
    log('Installing Bun...');
    if (run('bash', ['-c', 'curl -fsSL https://bun.sh/install | bash'])) {
      log('✓ Bun installed');
    } else {
      log('⚠ Bun install failed — aurix will fall back to Node');
    }
  }
}

// ─── 3. Node FFI probe (informative) ──────────────────────────────────────
try {
  execSync(`"${process.execPath}" -e "require(\\"node:ffi\\")"`, { stdio: 'ignore' });
  log('✓ node:ffi available without flag');
} catch {
  let flagWorks = false;
  try {
    execSync(`"${process.execPath}" --experimental-ffi -e "0"`, { stdio: 'ignore' });
    flagWorks = true;
  } catch {}
  if (flagWorks) {
    log('ℹ node:ffi requires --experimental-ffi (launcher injects it automatically)');
  } else {
    log('⚠ node:ffi not available on this Node build.');
    log('  Install Bun (recommended) or use official Node from nodejs.org.');
  }
}

log('');
log('✓ postinstall complete. Run `aurix` to start.');
