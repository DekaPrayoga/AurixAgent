#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log('║          Aurix Agent - Post-install Setup                 ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

const results = [];

try {
  console.log('[1/2] Patching react-reconciler for ESM compatibility...');
  const pkgPath = join(__dirname, '..', 'node_modules', 'react-reconciler', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  if (!pkg.exports) {
    pkg.exports = {
      '.': './index.js',
      './constants': './constants.js',
      './reflection': './reflection.js',
      './package.json': './package.json',
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log('  ✓ React-reconciler patched\n');
    results.push(['React-reconciler patch', 'success']);
  } else {
    console.log('  ✓ Already patched\n');
    results.push(['React-reconciler patch', 'skipped']);
  }
} catch (e) {
  console.warn('  ⚠ Could not patch react-reconciler:', e.message, '\n');
  results.push(['React-reconciler patch', 'failed']);
}

try {
  console.log('[2/2] Downloading CloakBrowser stealth Chromium binary...');
  console.log('  (This may take 1-2 minutes on first install)');
  const { ensureBinary } = await import('cloakbrowser');
  const binaryPath = await ensureBinary();
  console.log('  ✓ CloakBrowser binary ready:', binaryPath, '\n');
  results.push(['CloakBrowser binary', 'success']);
} catch (e) {
  console.warn('  ⚠ CloakBrowser binary download skipped:', e.message);
  console.warn('    Browser automation features will not be available.');
  console.warn('    To fix: ensure internet access and run "npm install" again.\n');
  results.push(['CloakBrowser binary', 'failed']);
}

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║                    Installation Summary                   ║');
console.log('╚═══════════════════════════════════════════════════════════╝');

for (const [name, status] of results) {
  const icon = status === 'success' ? '✓' : status === 'skipped' ? '⊘' : '⚠';
  console.log(`  ${icon} ${name}: ${status}`);
}

console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log('║  Setup complete! Run "aurix" to start the agent.          ║');
console.log('║  For issues: https://github.com/DekaPrayoga/AurixAgent    ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');
