import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_NAME = 'aurix-ai';

function readCurrentVersion(): string {
  // Preferred: launcher (bin/aurix.js) injects this at startup.
  if (process.env.AURIX_VERSION) return process.env.AURIX_VERSION;

  // Fallback: walk up from this module to find package.json. Works in
  // source tree (src/utils/UpdateCheck.ts → 2 levels up) and in dist
  // (dist/utils/UpdateCheck.js → 2 levels up).
  const candidates = [
    path.join(__dirname, '..', '..', 'package.json'),
    path.join(__dirname, '..', 'package.json'),
    path.join(process.env.AURIX_HOME || '', 'package.json'),
  ];
  for (const p of candidates) {
    try {
      if (!p || !fs.existsSync(p)) continue;
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (pkg.name === PKG_NAME && pkg.version) return pkg.version;
    } catch {}
  }
  return '0.0.0';
}

const CURRENT_VERSION = readCurrentVersion();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_FILE = path.join(os.homedir(), '.aurix', '.update-check.json');

function parseSemver(v: string): [number, number, number] {
  const m = v.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function isNewer(latest: string, current: string): boolean {
  const [a1, a2, a3] = parseSemver(latest);
  const [b1, b2, b3] = parseSemver(current);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

function fetchLatest(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${PKG_NAME}/latest`,
      { timeout: 3000 },
      (res) => {
        if (res.statusCode !== 200) { resolve(null); res.resume(); return; }
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            resolve(j.version || null);
          } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function loadCache(): { version: string; at: number } | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (typeof j.version === 'string' && typeof j.at === 'number') return j;
    return null;
  } catch { return null; }
}

function saveCache(version: string): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ version, at: Date.now() }), 'utf-8');
  } catch {}
}

// Non-blocking: prints an update banner if a newer version is available,
// otherwise returns silently. Cache result for 24h to avoid hitting the
// npm registry on every startup.
export async function checkForUpdate(): Promise<void> {
  const cached = loadCache();
  let latest: string | null = null;

  if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) {
    latest = cached.version;
  } else {
    latest = await fetchLatest();
    if (latest) saveCache(latest);
  }

  if (!latest) return;
  if (!isNewer(latest, CURRENT_VERSION)) return;

  // Box-drawing the banner to match AURIX's setup UI style.
  const lines = [
    `\x1b[38;2;250;178;131mA new version of ${PKG_NAME} is available: \x1b[1m${CURRENT_VERSION}\x1b[22m → \x1b[38;2;127;216;143;1m${latest}\x1b[0m\x1b[38;2;250;178;131m`,
    `Run \x1b[38;2;157;124;216;1mnpm i -g ${PKG_NAME}@latest\x1b[22m to update.\x1b[0m`,
  ];
  const width = Math.max(...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length)) + 2;
  const border = '\x1b[38;2;72;72;72m';
  console.log(`${border}╭${'─'.repeat(width)}╮\x1b[0m`);
  for (const line of lines) {
    const visible = line.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = width - visible.length;
    console.log(`${border}│\x1b[0m ${line}${' '.repeat(Math.max(0, pad - 1))}${border}│\x1b[0m`);
  }
  console.log(`${border}╰${'─'.repeat(width)}╯\x1b[0m`);
  console.log();
}
