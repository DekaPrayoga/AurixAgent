#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

try {
  execSync('node ' + path.resolve(__dirname, '..', 'node_modules', 'typescript', 'lib', 'tsc.js') + ' --project tsconfig.json', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
  });
} catch (e) {
  process.exit(1);
}

const nativeDir = path.join(__dirname, '..', 'native', 'token-counter');
const distDir = path.join(__dirname, '..', 'dist');
try {
  const files = fs.readdirSync(nativeDir).filter(f => f.endsWith('.node'));
  for (const f of files) {
    const src = path.join(nativeDir, f);
    const dest = path.join(distDir, f);
    fs.copyFileSync(src, dest);
    console.log(`[build] Copied ${f} to dist/`);
  }
} catch (e) {
  console.warn('[build] Could not copy .node binary:', e.message);
}
