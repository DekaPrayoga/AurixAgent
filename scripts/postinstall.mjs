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

function openTuiNativePackage(platform = process.platform, arch = process.arch, report = process.report?.getReport?.()) {
  if (!['x64', 'arm64'].includes(arch)) return null;
  if (platform === 'darwin') return `@opentui/core-darwin-${arch}`;
  if (platform === 'win32') return `@opentui/core-win32-${arch}`;
  if (platform === 'linux') {
    const glibc = report?.header?.glibcVersionRuntime;
    return `@opentui/core-linux-${arch}${glibc ? '' : '-musl'}`;
  }
  return null;
}

const corePackagePath = join(projectRoot, 'node_modules', '@opentui', 'core', 'package.json');
if (existsSync(corePackagePath)) {
  try {
    const { readFileSync } = await import('fs');
    const corePackage = JSON.parse(readFileSync(corePackagePath, 'utf8'));
    const pkgName = openTuiNativePackage();
    if (!pkgName) {
      log(`⚠ unsupported OpenTUI target: ${process.platform}/${process.arch}`);
    } else {
      const version = corePackage.optionalDependencies?.[pkgName] || corePackage.version;
      const expected = join(projectRoot, 'node_modules', '@opentui', pkgName.replace('@opentui/', ''));
      if (existsSync(expected)) {
        try {
          await import(pkgName);
          log(`✓ ${pkgName} already installed and loadable`);
        } catch (error) {
          log(`⚠ ${pkgName} exists but cannot load: ${error.message}`);
        }
      } else {
        log(`⚠ ${pkgName} missing — installing ${version}`);
        const ok = run('npm', ['install', '--no-save', '--no-audit', '--no-fund', `${pkgName}@${version}`], { cwd: projectRoot, shell: process.platform === 'win32' });
        if (!ok) log(`⚠ failed to install ${pkgName}; install optional dependencies manually`);
        else log(`✓ ${pkgName} installed`);
      }
    }
  } catch (error) {
    log(`⚠ Could not validate OpenTUI native dependency: ${error.message}`);
  }
} else {
  log('⚠ @opentui/core is missing; native dependency validation skipped');
}

// ─── 2. Ensure Bun runtime is available ────────────────────────────────────
try {
  execSync('bun --version', { stdio: 'ignore' });
  log('✓ Bun already installed');
} catch {
  log('Bun not found — installing Bun runtime automatically...');
  const ok = process.platform === 'win32'
    ? run('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'irm bun.sh/install.ps1 | iex',
      ], { shell: false })
    : run('bash', ['-c', 'curl -fsSL https://bun.sh/install | bash']);
  if (ok) {
    log('✓ Bun installed');
  } else {
    log('⚠ Bun install failed — aurix launcher will try managed Node at runtime');
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

// ─── 4. Fix react-reconciler/constants ESM import ──────────────────────────
try {
  const { readFileSync, writeFileSync, readdirSync } = await import('fs');
  const reactRoot = join(projectRoot, 'node_modules', '@opentui', 'react');
  const chunks = existsSync(reactRoot)
    ? readdirSync(reactRoot).filter((name) => name.endsWith('.js')).map((name) => join(reactRoot, name))
    : [];
  let patched = 0;
  for (const chunkPath of chunks) {
    let content = readFileSync(chunkPath, 'utf8');
    if (!content.includes('from "react-reconciler/constants"')) continue;
    content = content.replace(/from "react-reconciler\/constants"/g, 'from "react-reconciler/constants.js"');
    writeFileSync(chunkPath, content);
    patched++;
  }
  log(patched ? `✓ Fixed react-reconciler/constants ESM import in ${patched} file(s)` : '✓ react-reconciler/constants import already compatible');
} catch (e) {
  log(`⚠ Could not fix react-reconciler/constants import: ${e.message}`);
}

log('');
log('✓ postinstall complete. Run `aurix` to start.');
