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
