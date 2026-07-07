#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.DISPLAY = process.env.DISPLAY || ':0';
process.env.BROWSER_HEADLESS = process.env.BROWSER_HEADLESS || 'false';
process.env.BROWSER_PERSISTENT_PROFILE = process.env.BROWSER_PERSISTENT_PROFILE || 'true';

const repoRoot = path.resolve(import.meta.dirname, '..');
const distDir = path.join(repoRoot, 'dist');
if (!fs.existsSync(path.join(distDir, 'tools', 'Browser.js'))) {
  console.error('dist/ is missing. Run `npm run build` first.');
  process.exit(1);
}

const { browserTool } = await import('../dist/tools/Browser.js');

const logDir = path.join(os.homedir(), '.aurix', 'debug');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `direct-geetest-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const append = (text) => fs.appendFileSync(logFile, text + '\n');

async function call(args) {
  const started = Date.now();
  const result = await browserTool.execute(args);
  const elapsed = Date.now() - started;
  const header = `\n▶ browser ${JSON.stringify(args)} (${elapsed}ms)`;
  console.log(header);
  console.log(String(result).slice(0, 4000));
  append(header);
  append(String(result));
  return String(result);
}

console.log(`[direct] DISPLAY=${process.env.DISPLAY}`);
console.log(`[direct] BROWSER_HEADLESS=${process.env.BROWSER_HEADLESS}`);
console.log(`[direct] log=${logFile}`);

try {
  await call({ action: 'close' }).catch(() => '');
  await call({ action: 'navigate', value: 'https://www.geetest.com/en/adaptive-captcha-demo', timeout: 45000 });
  await call({
    action: 'screenshot',
    options: JSON.stringify({
      path: path.join(os.homedir(), '.aurix', 'debug', 'geetest-demo-loaded.png'),
      fullPage: false,
    }),
  });
  await call({ action: 'snapshot' });
  await call({ action: 'click', target: 'text=Click to verify', options: JSON.stringify({ timeout: 15000 }) });
  await call({ action: 'solve-captcha' });
  await call({
    action: 'screenshot',
    options: JSON.stringify({
      path: path.join(os.homedir(), '.aurix', 'debug', 'geetest-direct-final.png'),
      fullPage: false,
    }),
  });
} finally {
  await call({ action: 'status' }).catch(() => '');
}
