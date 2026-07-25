#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync, execSync } from 'child_process';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const dist = join(rootDir, 'dist', 'index.js');
const AURIX_HOME = process.env.AURIX_STATE_HOME || join(os.homedir(), '.aurix');
const MANAGED_NODE_DIR = join(AURIX_HOME, 'node');
const MIN_NODE = { major: 20, minor: 3, patch: 0 };
const TARGET_NODE_MAJOR = 22;

if (!existsSync(dist)) {
  console.error('Error: dist/index.js not found. Run "npm run build" first.');
  process.exit(1);
}

function log(message) {
  console.error(`[aurix bootstrap] ${message}`);
}

function parseVersion(raw) {
  const match = String(raw || '').match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return { major: 0, minor: 0, patch: 0 };
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isAtLeast(version, minimum) {
  if (version.major !== minimum.major) return version.major > minimum.major;
  if (version.minor !== minimum.minor) return version.minor > minimum.minor;
  return version.patch >= minimum.patch;
}

function nodeVersionOf(bin) {
  const result = spawnSync(bin, ['--version'], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return { major: 0, minor: 0, patch: 0 };
  return parseVersion(result.stdout || result.stderr);
}

function managedNodeBin() {
  if (process.platform === 'win32') return join(MANAGED_NODE_DIR, 'node.exe');
  return join(MANAGED_NODE_DIR, 'bin', 'node');
}

function managedNodeIsUsable() {
  const bin = managedNodeBin();
  return existsSync(bin) && isAtLeast(nodeVersionOf(bin), MIN_NODE);
}

function bunExecutableCandidates() {
  const candidates = ['bun'];
  if (process.platform === 'win32') {
    if (process.env.USERPROFILE) candidates.push(join(process.env.USERPROFILE, '.bun', 'bin', 'bun.exe'));
    if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'bun', 'bun.exe'));
  } else {
    candidates.push(join(os.homedir(), '.bun', 'bin', 'bun'));
  }
  return candidates;
}

function findBun() {
  for (const candidate of bunExecutableCandidates()) {
    const result = spawnSync(candidate, ['--version'], {
      stdio: 'ignore',
      shell: candidate === 'bun' && process.platform === 'win32',
    });
    if (result.status === 0) return candidate;
  }
  return undefined;
}

function installBun() {
  if (process.env.AURIX_SKIP_RUNTIME_BOOTSTRAP === '1') return undefined;
  log('Bun runtime not found — installing Bun for the terminal renderer...');
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            'irm bun.sh/install.ps1 | iex',
          ],
          { stdio: 'inherit' },
        )
      : spawnSync('bash', ['-c', 'curl -fsSL https://bun.sh/install | bash'], {
          stdio: 'inherit',
        });
  if (result.status !== 0) return undefined;
  return findBun();
}

function nodeHasFfi(bin) {
  const probe = spawnSync(bin, ['-e', 'require("node:ffi")'], {
    stdio: 'ignore',
    shell: false,
  });
  if (probe.status === 0) return true;
  const withFlag = spawnSync(bin, ['--experimental-ffi', '-e', '0'], {
    stdio: 'ignore',
    shell: false,
  });
  return withFlag.status === 0;
}

function fetchText(url) {
  const script = `
    const https = require('https');
    https.get(${JSON.stringify(url)}, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, (r) => r.pipe(process.stdout)).on('error', () => process.exit(1));
        return;
      }
      if (res.statusCode !== 200) process.exit(1);
      res.pipe(process.stdout);
    }).on('error', () => process.exit(1));
  `;
  const result = spawnSync('node', ['-e', script], { encoding: 'utf8', shell: false });
  return result.status === 0 ? result.stdout : undefined;
}

function downloadFile(url, target) {
  const script = `
    const fs = require('fs');
    const https = require('https');
    const file = fs.createWriteStream(${JSON.stringify(target)});
    https.get(${JSON.stringify(url)}, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, (r) => r.pipe(file)).on('error', () => process.exit(1));
        return;
      }
      if (res.statusCode !== 200) process.exit(1);
      res.pipe(file);
      file.on('finish', () => file.close(() => process.exit(0)));
    }).on('error', () => process.exit(1));
  `;
  return spawnSync('node', ['-e', script], { stdio: 'inherit', shell: false }).status === 0;
}

function platformSpec() {
  let osName;
  if (process.platform === 'linux') osName = 'linux';
  else if (process.platform === 'darwin') osName = 'darwin';
  else if (process.platform === 'win32') osName = 'win';
  else return null;

  let arch;
  if (process.arch === 'x64') arch = 'x64';
  else if (process.arch === 'arm64') arch = 'arm64';
  else if (process.arch === 'arm') arch = 'armv7l';
  else return null;

  const ext = process.platform === 'win32' ? 'zip' : 'tar.xz';
  return { osName, arch, ext };
}

function installManagedNode() {
  const spec = platformSpec();
  if (!spec) {
    log(
      `Unsupported platform for managed Node install: ${process.platform}-${process.arch}`,
    );
    return false;
  }

  const indexUrl = `https://nodejs.org/dist/latest-v${TARGET_NODE_MAJOR}.x/`;
  const listing = fetchText(indexUrl);
  if (!listing) {
    log('Could not reach nodejs.org to download a compatible Node runtime.');
    return false;
  }

  const escaped = `${spec.osName}-${spec.arch}.${spec.ext}`.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
  const regex = new RegExp(
    `node-v${TARGET_NODE_MAJOR}\\.\\d+\\.\\d+-${escaped}`,
    'g',
  );
  const matches = Array.from(new Set(listing.match(regex) || []));
  const tarball = matches[0];
  if (!tarball) {
    log(
      `No Node ${TARGET_NODE_MAJOR} binary found for ${spec.osName}-${spec.arch}.`,
    );
    return false;
  }

  mkdirSync(AURIX_HOME, { recursive: true });
  const tmp = join(os.tmpdir(), `aurix-node-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const archive = join(tmp, tarball);
  log(`Downloading ${tarball}...`);

  if (!downloadFile(indexUrl + tarball, archive)) return false;

  log(`Extracting Node to ${MANAGED_NODE_DIR}...`);
  rmSync(MANAGED_NODE_DIR, { recursive: true, force: true });
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath ${JSON.stringify(archive)} -DestinationPath ${JSON.stringify(tmp)} -Force`,
      ],
      { stdio: 'inherit' },
    );
    if (ps.status !== 0) return false;
    const extracted = join(tmp, tarball.replace(/\.zip$/, ''));
    spawnSync('cmd.exe', ['/c', 'move', extracted, MANAGED_NODE_DIR], {
      stdio: 'ignore',
    });
  } else {
    const tar = spawnSync('tar', ['xf', archive, '-C', tmp], {
      stdio: 'inherit',
    });
    if (tar.status !== 0) return false;
    const extracted = join(tmp, tarball.replace(/\.tar\.xz$/, ''));
    mkdirSync(AURIX_HOME, { recursive: true });
    spawnSync('mv', [extracted, MANAGED_NODE_DIR], { stdio: 'ignore' });
  }

  rmSync(tmp, { recursive: true, force: true });
  return managedNodeIsUsable();
}

function resolveRuntime() {
  // Prefer an existing Bun runtime. It avoids Node FFI flag issues and usually
  // runs packages even when npm's Node engine gate rejected system Node.
  const existingBun = findBun();
  if (existingBun) return { kind: 'bun', bin: existingBun, args: [] };

  if (isAtLeast(parseVersion(process.version), MIN_NODE) && nodeHasFfi(process.execPath)) {
    return {
      kind: 'node',
      bin: process.execPath,
      args: nodeArgsFor(process.execPath),
    };
  }

  if (managedNodeIsUsable() && nodeHasFfi(managedNodeBin())) {
    const bin = managedNodeBin();
    return { kind: 'node', bin, args: nodeArgsFor(bin), managed: true };
  }

  if (!isAtLeast(parseVersion(process.version), MIN_NODE)) {
    log(
      `Current Node ${process.version} is unsupported. Aurix needs Node >=20.3.0 (Node ${TARGET_NODE_MAJOR} recommended).`,
    );
  } else {
    log(
      `Current Node ${process.version} is missing node:ffi support. Aurix will install Bun for the terminal renderer.`,
    );
  }
  if (process.env.AURIX_SKIP_RUNTIME_BOOTSTRAP === '1') {
    return {
      kind: 'node',
      bin: process.execPath,
      args: nodeArgsFor(process.execPath),
    };
  }

  const installedBun = installBun();
  if (installedBun) return { kind: 'bun', bin: installedBun, args: [] };

  if (installManagedNode() && nodeHasFfi(managedNodeBin())) {
    const bin = managedNodeBin();
    log(
      `Using managed Node ${nodeVersionOf(bin).major}.x from ${MANAGED_NODE_DIR}`,
    );
    return { kind: 'node', bin, args: nodeArgsFor(bin), managed: true };
  }

  console.error('Aurix could not install a compatible runtime automatically.');
  console.error('Install Bun or Node 22 with node:ffi support, then run `aurix` again.');
  process.exit(1);
}

function nodeArgsFor(bin) {
  const args = [];
  if (process.env.AURIX_RELAUNCHED) return args;
  let needsFlag = false;
  try {
    execSync(`"${bin}" -e "require(\\"node:ffi\\")"`, { stdio: 'ignore' });
  } catch {
    needsFlag = true;
  }
  if (!needsFlag) return args;
  try {
    execSync(`"${bin}" --experimental-ffi -e "0"`, { stdio: 'ignore' });
    args.push('--experimental-ffi');
  } catch {}
  return args;
}

const runtime = resolveRuntime();
const runtimeVersionResult = spawnSync(runtime.bin, ['--version'], {
  encoding: 'utf8',
  shell: false,
});
const runtimeVersion = String(
  runtimeVersionResult.stdout || runtimeVersionResult.stderr || '',
).trim().replace(/^v/, '');
const env = {
  ...process.env,
  AURIX_HOME: rootDir,
  AURIX_RUNTIME_KIND: runtime.kind,
  AURIX_RUNTIME_VERSION: runtimeVersion,
  AURIX_RUNTIME_MANAGED: runtime.managed ? '1' : '0',
};
if (runtime.kind === 'node' && runtime.args.length > 0)
  env.AURIX_RELAUNCHED = '1';
if (runtime.managed)
  env.PATH = `${dirname(managedNodeBin())}${process.platform === 'win32' ? ';' : ':'}${env.PATH || ''}`;

try {
  const pkgPath = join(rootDir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (pkg.version) env.AURIX_VERSION = pkg.version;
  }
} catch {}

const child = spawn(
  runtime.bin,
  [...runtime.args, dist, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env,
  },
);

child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(`Failed to start: ${err.message}`);
  process.exit(1);
});
