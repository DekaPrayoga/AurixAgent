#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '..', 'node_modules', 'react-reconciler', 'package.json');

try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  if (!pkg.exports) {
    pkg.exports = {
      '.': './index.js',
      './constants': './constants.js',
      './reflection': './reflection.js',
      './package.json': './package.json',
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log('[postinstall] Patched react-reconciler exports for ESM compatibility');
  }
} catch (e) {
  console.warn('[postinstall] Could not patch react-reconciler:', e.message);
}

try {
  console.log('[postinstall] Ensuring CloakBrowser stealth Chromium binary...');
  const { ensureBinary } = await import('cloakbrowser');
  const binaryPath = await ensureBinary();
  console.log('[postinstall] CloakBrowser binary ready:', binaryPath);
} catch (e) {
  console.warn('[postinstall] CloakBrowser binary download skipped:', e.message);
}

import { execSync } from 'child_process';
import { existsSync } from 'fs';

const nativeDir = join(__dirname, '..', 'native', 'token-counter');
try {
  if (existsSync(nativeDir)) {
    console.log('[postinstall] Building Rust token counter...');
    execSync('npx napi build --release --platform', { cwd: nativeDir, stdio: 'inherit' });
    console.log('[postinstall] Rust token counter built successfully');
  }
} catch (e) {
  console.warn('[postinstall] Rust token counter build failed (fallback will be used):', e.message);
}
