#!/usr/bin/env node
const path = require('path');
process.argv = ['node', 'tsc', ...process.argv.slice(2)];
require(path.resolve(__dirname, '..', 'node_modules', 'typescript', 'lib', 'tsc.js'));
