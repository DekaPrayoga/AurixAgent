import { execFile, execFileSync, spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function runCmd(
  cmd: string,
  args: string[],
  input?: string,
  env?: Record<string, string>,
  timeout = 2000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { timeout, env: env ? { ...process.env, ...env } : undefined, windowsHide: true },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      }
    );
    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

export function isPasteKey(evt: {
  name: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}): boolean {
  return (
    evt.sequence === '\x16' ||
    (!!(evt.ctrl || evt.meta) && (evt.name === 'v' || evt.name === 'V')) ||
    (!!evt.shift && (evt.name === 'insert' || evt.name === 'Insert'))
  );
}

export function normalizeClipboardText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

let cachedDisplay: { display: string; xauth: string } | null | undefined;

function findDisplay(): { display: string; xauth: string } | null {
  if (cachedDisplay !== undefined) return cachedDisplay;

  const home = process.env.HOME || process.env.USERPROFILE || '';
  const xauthCandidates = [process.env.XAUTHORITY, home && `${home}/.Xauthority`].filter(
    Boolean
  ) as string[];

  let xauth = '';
  for (const p of xauthCandidates) {
    try {
      fs.accessSync(p);
      xauth = p;
      break;
    } catch {}
  }

  if (process.env.DISPLAY) {
    cachedDisplay = { display: process.env.DISPLAY, xauth };
    return cachedDisplay;
  }

  try {
    const sockets = fs.readdirSync('/tmp/.X11-unix/');
    for (const s of sockets) {
      if (s.startsWith('X')) {
        cachedDisplay = { display: `:${s.slice(1)}`, xauth };
        return cachedDisplay;
      }
    }
  } catch {}

  try {
    const out = execFileSync('nxserver', ['--list'], { timeout: 2000, encoding: 'utf8' });
    const match = out.match(/(\d{3,4})\s+\w+\s+[\d.]+/);
    if (match) {
      cachedDisplay = { display: `:${match[1]}`, xauth };
      return cachedDisplay;
    }
  } catch {}

  cachedDisplay = null;
  return null;
}

function xclipEnv(): Record<string, string> | undefined {
  const d = findDisplay();
  if (!d?.display) return undefined;
  const env: Record<string, string> = { DISPLAY: d.display };
  if (d.xauth) env.XAUTHORITY = d.xauth;
  return env;
}

async function readWindowsClipboard(): Promise<string | undefined> {
  const args = [
    '-NoProfile',
    '-Sta',
    '-Command',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $clip = Get-Clipboard -Raw -ErrorAction SilentlyContinue; if ($null -ne $clip) { [Console]::Out.Write($clip) }',
  ];

  for (const cmd of ['powershell.exe', 'powershell']) {
    try {
      const text = await runCmd(cmd, args, undefined, undefined, 4000);
      if (text) return normalizeClipboardText(text);
    } catch {}
  }
  return undefined;
}

export function readClipboard(): Promise<string | undefined> {
  return (async () => {
    if (isMac) {
      try {
        const t = await runCmd('pbpaste', []);
        if (t) return t;
      } catch {}
      return undefined;
    }

    if (isWindows) return readWindowsClipboard();

    if (process.env.WAYLAND_DISPLAY) {
      try {
        const t = await runCmd('wl-paste', ['--no-newline']);
        if (t) return t;
      } catch {}
    }

    const env = xclipEnv();
    if (env || process.env.DISPLAY) {
      try {
        const t = await runCmd('xclip', ['-selection', 'clipboard', '-o'], undefined, env);
        if (t) return t;
      } catch {}
      try {
        const t = await runCmd('xsel', ['--clipboard', '--output'], undefined, env);
        if (t) return t;
      } catch {}
    }

    return undefined;
  })();
}

async function tryWriteClipboardCommand(
  cmd: string,
  args: string[],
  text: string,
  env: Record<string, string>
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = nodeSpawn(cmd, args, {
        stdio: ['pipe', 'ignore', 'ignore'],
        env,
        windowsHide: true,
      });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
      child.stdin?.end(text);
    } catch {
      resolve(false);
    }
  });
}

export function writeClipboard(text: string): void {
  const b64 = Buffer.from(text).toString('base64');
  const osc52 = `\x1b]52;c;${b64}\x07`;
  process.stdout.write(process.env.TMUX ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52);

  (async () => {
    const clipEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
    if (process.env.DISPLAY) clipEnv.DISPLAY = process.env.DISPLAY;
    if (process.env.XAUTHORITY) clipEnv.XAUTHORITY = process.env.XAUTHORITY;
    const tools: [string, string[]][] = isWindows
      ? [
          [
            'powershell.exe',
            [
              '-NoProfile',
              '-Sta',
              '-Command',
              '$inputText = [Console]::In.ReadToEnd(); Set-Clipboard -Value $inputText',
            ],
          ],
          [
            'powershell',
            [
              '-NoProfile',
              '-Sta',
              '-Command',
              '$inputText = [Console]::In.ReadToEnd(); Set-Clipboard -Value $inputText',
            ],
          ],
          ['clip.exe', []],
        ]
      : [
          ['wl-copy', []],
          ['xclip', ['-selection', 'clipboard']],
          ['xsel', ['--clipboard', '--input']],
          ['pbcopy', []],
        ];
    for (const [cmd, args] of tools) {
      if (await tryWriteClipboardCommand(cmd, args, text, clipEnv)) return;
    }
  })().catch(() => {});
}

export function readClipboardImage(): Promise<string | undefined> {
  return (async () => {
    const sp = nodeSpawn;
    const tmpFile = `/tmp/aurix-paste-${Date.now()}.png`;
    const env = xclipEnv();
    const fullEnv = env ? { ...process.env, ...env } : undefined;

    if (isMac) {
      return new Promise<string | undefined>((resolve) => {
        const script = `set theFile to (POSIX file "${tmpFile}")
try
  set theClip to the clipboard as «class PNGf»
  set fRef to open for access theFile with write permission
  write theClip to fRef
  close access fRef
on error
  try
    close access theFile
  end try
  return ""
end try
return "ok"`;
        const child = sp('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        child.stdout?.on('data', (d: Buffer) => {
          out += d;
        });
        child.on('close', () => resolve(out.includes('ok') ? tmpFile : undefined));
        child.on('error', () => resolve(undefined));
      });
    }

    if (isWindows) {
      const tmpFileWin = path.join(os.tmpdir(), `aurix-paste-${Date.now()}.png`);
      return new Promise<string | undefined>((resolve) => {
        const escapedPath = tmpFileWin.replace(/'/g, "''");
        const psScript = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($null -ne $img) { $img.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png); [Console]::Out.Write('ok') }`;
        const child = sp('powershell.exe', ['-NoProfile', '-Sta', '-Command', psScript], {
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        });
        let out = '';
        child.stdout?.on('data', (d: Buffer) => {
          out += d;
        });
        child.on('close', () => resolve(out.includes('ok') ? tmpFileWin : undefined));
        child.on('error', () => resolve(undefined));
      });
    }

    if (process.env.WAYLAND_DISPLAY) {
      return new Promise<string | undefined>((resolve) => {
        const child = sp('wl-paste', ['--type', 'image/png'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const chunks: Buffer[] = [];
        child.stdout?.on('data', (d: Buffer) => chunks.push(d));
        child.on('close', (code: number) => {
          if (code === 0 && chunks.length > 0) {
            fs.writeFileSync(tmpFile, Buffer.concat(chunks));
            resolve(tmpFile);
          } else resolve(undefined);
        });
        child.on('error', () => resolve(undefined));
      });
    }

    return new Promise<string | undefined>((resolve) => {
      const child = sp('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: fullEnv,
      });
      const chunks: Buffer[] = [];
      child.stdout?.on('data', (d: Buffer) => chunks.push(d));
      child.on('close', (code: number) => {
        if (code === 0 && chunks.length > 0) {
          fs.writeFileSync(tmpFile, Buffer.concat(chunks));
          resolve(tmpFile);
        } else resolve(undefined);
      });
      child.on('error', () => resolve(undefined));
    });
  })();
}
