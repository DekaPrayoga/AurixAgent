#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, '..', 'dist', 'index.js');

if (!existsSync(dist)) {
  console.error('Error: dist/index.js not found. Run "npm run build" first.');
  process.exit(1);
}

// Prefer Bun if installed — Bun has built-in FFI, no flag needed.
let runtime = 'node';
try {
  execSync('bun --version', { stdio: 'ignore' });
  runtime = 'bun';
} catch {}

// Use shell: false with an absolute path to the Node binary. shell: true
// triggers DEP0190 (args concatenated without escaping). process.execPath
// points at the real node.exe even when launched through a .cmd shim on
// Windows, so spawn() works without shell: true.
let runtimeBin = process.execPath;
if (runtime === 'bun') {
  try {
    runtimeBin = execSync('bun -e "process.stdout.write(process.execPath)"', { encoding: 'utf8' }).trim() || 'bun';
  } catch {
    runtimeBin = 'bun';
  }
}

const nodeArgs = [];
let selfRelaunch = false;

if (runtime === 'node' && !process.env.AURIX_RELAUNCHED) {
  // OpenTUI's backend does `require("node:ffi")` which is experimental in
  // Node 22.5+. Probe whether it already works without a flag, and only
  // inject --experimental-ffi if it actually fails AND the flag is valid
  // on this Node build. If neither works, launch without the flag and let
  // the in-process fallback render a diagnostic message.
  let needsFlag = false;
  try {
    execSync(`"${runtimeBin}" -e "require(\\"node:ffi\\")"`, { stdio: 'ignore' });
  } catch {
    needsFlag = true;
  }

  if (needsFlag) {
    let flagWorks = false;
    try {
      execSync(`"${runtimeBin}" --experimental-ffi -e "0"`, { stdio: 'ignore' });
      flagWorks = true;
    } catch {}

    if (flagWorks) {
      nodeArgs.push('--experimental-ffi');
      selfRelaunch = true;
    }
  }
}

const env = { ...process.env, AURIX_HOME: join(__dirname, '..') };

// Read version from package.json (which lives one level up from bin/) and
// pass it to the child so in-process components (like the update check)
// can know the current version without searching the filesystem.
try {
  const pkgPath = join(__dirname, '..', 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (pkg.version) env.AURIX_VERSION = pkg.version;
  }
} catch {}

if (selfRelaunch) env.AURIX_RELAUNCHED = '1';

const child = spawn(runtimeBin, [...nodeArgs, dist, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(`Failed to start: ${err.message}`);
  process.exit(1);
});
