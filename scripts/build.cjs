#!/usr/bin/env node
const path = require('path');
process.argv = ['node', 'tsc', '--project', 'tsconfig.json'];
require(path.resolve(__dirname, '..', 'node_modules', 'typescript', 'lib', 'tsc.js'));
