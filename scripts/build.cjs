#!/usr/bin/env node
const path = require('path');
const { execSync } = require('child_process');

try {
  execSync('node ' + path.resolve(__dirname, '..', 'node_modules', 'typescript', 'lib', 'tsc.js') + ' --project tsconfig.json', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
  });
} catch (e) {
  process.exit(1);
}
