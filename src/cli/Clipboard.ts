import { execFile, execFileSync, spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';

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

export interface ClipboardImage {
  mime: string;
  base64: string;
  byteLength: number;
}

const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;

function clipboardImage(buffer: Buffer): ClipboardImage | undefined {
  if (!buffer.length || buffer.length > MAX_CLIPBOARD_IMAGE_BYTES) return undefined;
  return { mime: 'image/png', base64: buffer.toString('base64'), byteLength: buffer.length };
}

export function readClipboardImage(): Promise<ClipboardImage | undefined> {
  return (async () => {
    const env = xclipEnv();
    const fullEnv = env ? { ...process.env, ...env } : undefined;
    if (isMac) {
      return new Promise<ClipboardImage | undefined>((resolve) => {
        const script = 'try\nset pngData to the clipboard as «class PNGf»\nreturn pngData\non error\nreturn ""\nend try';
        const child = nodeSpawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
        const chunks: Buffer[] = [];
        child.stdout?.on('data', (data: Buffer) => chunks.push(data));
        child.on('close', () => resolve(clipboardImage(Buffer.concat(chunks))));
        child.on('error', () => resolve(undefined));
      });
    }
    if (isWindows) {
      return new Promise<ClipboardImage | undefined>((resolve) => {
        const script = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $img=[System.Windows.Forms.Clipboard]::GetImage(); if($null-ne $img){$ms=New-Object IO.MemoryStream; $img.Save($ms,[Drawing.Imaging.ImageFormat]::Png); [Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))}";
        const child = nodeSpawn('powershell.exe', ['-NoProfile', '-Sta', '-Command', script], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
        let base64 = '';
        child.stdout?.on('data', (data: Buffer) => base64 += data.toString());
        child.on('close', () => {
          try { resolve(clipboardImage(Buffer.from(base64.trim(), 'base64'))); } catch { resolve(undefined); }
        });
        child.on('error', () => resolve(undefined));
      });
    }
    const command = process.env.WAYLAND_DISPLAY
      ? ['wl-paste', ['--type', 'image/png']] as const
      : ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']] as const;
    return new Promise<ClipboardImage | undefined>((resolve) => {
      const child = nodeSpawn(command[0], [...command[1]], { stdio: ['ignore', 'pipe', 'ignore'], env: fullEnv });
      const chunks: Buffer[] = [];
      child.stdout?.on('data', (data: Buffer) => chunks.push(data));
      child.on('close', (code) => resolve(code === 0 ? clipboardImage(Buffer.concat(chunks)) : undefined));
      child.on('error', () => resolve(undefined));
    });
  })();
}
