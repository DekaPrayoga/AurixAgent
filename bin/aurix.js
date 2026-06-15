#!/usr/bin/env node
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, 'dist', 'index.js');

if (!existsSync(dist)) {
  console.error('Error: dist/index.js not found. Run "npm run build" first.');
  process.exit(1);
}

let runtime = 'node';
try {
  execSync('bun --version', { stdio: 'ignore' });
  runtime = 'bun';
} catch {}

const child = spawn(runtime, [dist, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, AURIX_HOME: join(__dirname) },
  shell: process.platform === 'win32',
});

child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(`Failed to start: ${err.message}`);
  process.exit(1);
});
