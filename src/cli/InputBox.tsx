import React, { useEffect, useMemo, useState } from 'react';
import { TextAttributes, decodePasteBytes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions, usePaste } from '@opentui/react';
import { execFile } from 'node:child_process';
import { theme } from './theme.js';
import type { SlashCommand } from './commands.js';
import { completeCommand, filterSlashCommands } from './commands.js';
import { filterFiles } from './fileList.js';

function runCmd(cmd: string, args: string[], input?: string, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: 2000, env: env ? { ...process.env, ...env } : undefined }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

let cachedDisplay: { display: string; xauth: string } | null | undefined;

function findDisplay(): { display: string; xauth: string } | null {
  if (isWindows || isMac) return null;
  if (cachedDisplay !== undefined) return cachedDisplay;

  const fs = require('fs');
  const home = process.env.HOME || '';

  const xauthCandidates = [
    process.env.XAUTHORITY,
    home && `${home}/.Xauthority`,
  ].filter(Boolean) as string[];

  let xauth = '';
  for (const p of xauthCandidates) {
    try { fs.accessSync(p); xauth = p; break; } catch {}
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
    const { execFileSync } = require('child_process');
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

function readClipboard(): Promise<string | undefined> {
  return (async () => {
    if (isMac) {
      try { const t = await runCmd('pbpaste', []); if (t) return t; } catch {}
      return undefined;
    }
    if (isWindows) {
      try {
        const t = await runCmd('powershell.exe', [
          '-NoProfile', '-command',
          '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard',
        ]);
        if (t) return t.replace(/\r\n/g, '\n');
      } catch {}
      return undefined;
    }
    if (process.env.WAYLAND_DISPLAY) {
      try { const t = await runCmd('wl-paste', ['--no-newline']); if (t) return t; } catch {}
    }
    const env = xclipEnv();
    if (env || process.env.DISPLAY) {
      try { const t = await runCmd('xclip', ['-selection', 'clipboard', '-o'], undefined, env); if (t) return t; } catch {}
      try { const t = await runCmd('xsel', ['--clipboard', '--output'], undefined, env); if (t) return t; } catch {}
    }
    return undefined;
  })();
}

export function writeClipboard(text: string): void {
  const fs = require('node:fs');
  const logFile = '/tmp/aurix-copy-debug.log';
  const log = (msg: string) => {
    try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
  };

  log(`--- COPY START ---`);
  log(`text length=${text.length}, first50=${JSON.stringify(text.slice(0, 50))}`);
  log(`DISPLAY=${process.env.DISPLAY || '(unset)'}, WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY || '(unset)'}, TMUX=${process.env.TMUX || '(unset)'}`);
  log(`isMac=${isMac}, isWindows=${isWindows}`);

  const b64 = Buffer.from(text).toString('base64');
  const osc52 = `\x1b]52;c;${b64}\x07`;
  const osc52Sent = process.env.TMUX ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52;
  process.stdout.write(osc52Sent);
  log(`OSC52 sent (length=${osc52Sent.length})`);

  if (isWindows) {
    log(`method: powershell`);
    const child = execFile('powershell.exe', [
      '-NoProfile', '-command',
      `Set-Clipboard -Value '${text.replace(/'/g, "''")}'`,
    ], { timeout: 2000 }, (err) => {
      log(`powershell exit: err=${err ? err.message : 'ok'}`);
    });
    return;
  }
  if (isMac) {
    log(`method: pbcopy`);
    const { spawn } = require('node:child_process');
    const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'pipe'] });
    child.stdin?.end(text);
    child.on('error', (e: Error) => log(`pbcopy error: ${e.message}`));
    child.on('exit', (code: number) => log(`pbcopy exit: code=${code}`));
    return;
  }
  if (process.env.WAYLAND_DISPLAY) {
    log(`method: wl-copy`);
    const { spawn } = require('node:child_process');
    const child = spawn('wl-copy', ['--', text], { stdio: ['pipe', 'ignore', 'pipe'] });
    child.on('error', (e: Error) => log(`wl-copy error: ${e.message}`));
    child.on('exit', (code: number) => log(`wl-copy exit: code=${code}`));
    return;
  }
  const env = xclipEnv();
  log(`xclipEnv: ${JSON.stringify(env)}`);
  if (env || process.env.DISPLAY) {
    log(`method: xclip`);
    const { spawn } = require('node:child_process');
    const fullEnv = env ? { ...process.env, ...env } : undefined;
    const child = spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'pipe', 'pipe'], env: fullEnv });
    child.stdin?.end(text);
    child.on('error', (e: Error) => log(`xclip error: ${e.message}`));
    child.on('exit', (code: number) => log(`xclip exit: code=${code}`));
    child.stderr?.on('data', (d: Buffer) => log(`xclip stderr: ${d.toString().trim()}`));
    setTimeout(() => {
      try {
        const { execFileSync } = require('node:child_process');
        const verify = execFileSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf8', timeout: 2000, env: fullEnv });
        log(`verify readback: length=${verify.length}, match=${verify === text}`);
      } catch (e: any) {
        log(`verify readback FAILED: ${e.message}`);
      }
    }, 500);
    return;
  }
  log(`NO METHOD MATCHED — clipboard not written (no DISPLAY, no WAYLAND, not mac, not windows)`);
}

function readClipboardImage(): Promise<string | undefined> {
  return (async () => {
    const { spawn: sp } = require('node:child_process');
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
        child.stdout?.on('data', (d: Buffer) => { out += d; });
        child.on('close', () => resolve(out.includes('ok') ? tmpFile : undefined));
        child.on('error', () => resolve(undefined));
      });
    }

    if (isWindows) {
      const tmpFileWin = require('path').join(require('os').tmpdir(), `aurix-paste-${Date.now()}.png`);
      return new Promise<string | undefined>((resolve) => {
        const psScript = `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img -ne $null) { $img.Save('${tmpFileWin.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png); Write-Output 'ok' } else { Write-Output '' }`;
        const child = sp('powershell', ['-NoProfile', '-Command', psScript], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
        let out = '';
        child.stdout?.on('data', (d: Buffer) => { out += d; });
        child.on('close', () => resolve(out.includes('ok') ? tmpFileWin : undefined));
        child.on('error', () => resolve(undefined));
      });
    }

    if (process.env.WAYLAND_DISPLAY) {
      return new Promise<string | undefined>((resolve) => {
        const child = sp('wl-paste', ['--type', 'image/png'], { stdio: ['ignore', 'pipe', 'ignore'] });
        const chunks: Buffer[] = [];
        child.stdout?.on('data', (d: Buffer) => chunks.push(d));
        child.on('close', (code: number) => {
          if (code === 0 && chunks.length > 0) {
            require('fs').writeFileSync(tmpFile, Buffer.concat(chunks));
            resolve(tmpFile);
          } else resolve(undefined);
        });
        child.on('error', () => resolve(undefined));
      });
    }

    return new Promise<string | undefined>((resolve) => {
      const child = sp('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], { stdio: ['ignore', 'pipe', 'ignore'], env: fullEnv });
      const chunks: Buffer[] = [];
      child.stdout?.on('data', (d: Buffer) => chunks.push(d));
      child.on('close', (code: number) => {
        if (code === 0 && chunks.length > 0) {
          require('fs').writeFileSync(tmpFile, Buffer.concat(chunks));
          resolve(tmpFile);
        } else resolve(undefined);
      });
      child.on('error', () => resolve(undefined));
    });
  })();
}

interface InputBoxProps {
  onSubmit: (value: string) => void;
  disabled: boolean;
  commands?: SlashCommand[];
  home?: boolean;
  model?: string;
  contextPct?: number;
  cwd?: string;
  mode?: 'auto' | 'ask';
  onModeCycle?: () => void;
  onExit?: () => void;
  onRewind?: () => boolean;
}

const MODE_LABEL: Record<'auto' | 'ask', string> = {
  auto: 'Auto',
  ask: 'Ask',
};
const MODE_COLOR: Record<'auto' | 'ask', string> = {
  auto: theme.ok,
  ask: theme.secondary,
};

let pasteInProgress = false;
let lastPasteStart = -1;
let lastPasteLen = 0;
let lastCtrlCEmpty = 0;
const pastedBlocks = new Map<string, string>();

export function InputBox({ onSubmit, disabled, commands = [], home = false, model, contextPct = 0, cwd, mode = 'auto', onModeCycle, onExit, onRewind }: InputBoxProps) {
  const { width: termWidth } = useTerminalDimensions();

  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [tick, setTick] = useState(0);
  const lastEscRef = React.useRef<number>(0);

  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 530);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (process.stdin.isTTY) {
      process.stdout.write('\x1b[?2004h');
    }
    const onContinue = () => {
      if (process.stdin.isTTY) process.stdout.write('\x1b[?2004h');
    };
    process.on('SIGCONT', onContinue);
    return () => {
      process.removeListener('SIGCONT', onContinue);
      if (process.stdin.isTTY) process.stdout.write('\x1b[?2004l');
    };
  }, []);

  usePaste((event) => {
    if (disabled) return;
    pasteInProgress = true;
    const text = decodePasteBytes(event.bytes).replace(/\r\n/g, '\n').trimEnd();
    pasteInProgress = false;

    if (text) {
      const lines = text.split('\n');
      if (lines.length >= 2 || text.length > 200) {
        const placeholder = `[pasted-${pastedBlocks.size + 1}]`;
        pastedBlocks.set(placeholder, text);
        setValue(prev => prev + placeholder);
        setCursor(prev => prev + placeholder.length);
      } else {
        setValue(prev => prev + text);
        setCursor(prev => prev + text.length);
      }
    }
  });

  const frame = () => {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return frames[tick % frames.length];
  };

  const commandQuery = value.startsWith('/') && !/\s/.test(value.slice(1))
    ? value.slice(1)
    : null;

  const suggestions = useMemo(() => {
    if (commandQuery === null || commands.length === 0) return [];
    return filterSlashCommands(commands, commandQuery, home ? 20 : 30);
  }, [commandQuery, commands, home]);

  const suggestionsVisible = suggestions.length > 0;
  useEffect(() => { setSelectedCommand(0); }, [commandQuery]);

  // @-mention: detect a trailing @token (no whitespace after the @) to attach a file.
  const atQuery = (() => {
    const m = value.match(/(?:^|\s)@([^\s]*)$/);
    return m ? m[1] : null;
  })();
  const fileSuggestions = useMemo(() => {
    if (atQuery === null) return [];
    return filterFiles(atQuery, 12);
  }, [atQuery]);
  const fileSuggestionsVisible = fileSuggestions.length > 0;
  useEffect(() => { setSelectedCommand(0); }, [atQuery]);

  function applyFileCompletion(index = selectedCommand) {
    const file = fileSuggestions[index];
    if (!file) return;
    const next = value.replace(/(^|\s)@([^\s]*)$/, `$1@${file} `);
    setValue(next);
    setCursor(next.length);
  }

  function applyCommandCompletion(index = selectedCommand) {
    const command = suggestions[index];
    if (!command) return;
    const next = completeCommand(command);
    setValue(next);
    setCursor(next.length);
  }

  useKeyboard((evt) => {
    if (disabled || pasteInProgress) return;
    const name = evt.name;

    if (name === 'escape') {
      evt.preventDefault();
      lastPasteStart = -1;
      lastPasteLen = 0;
      if (value) {
        setValue('');
        setCursor(0);
        lastEscRef.current = 0;
        return;
      }
      // Input empty: double-press ESC within 800ms triggers rewind.
      const now = Date.now();
      if (now - lastEscRef.current <= 800) {
        lastEscRef.current = 0;
        onRewind?.();
      } else {
        lastEscRef.current = now;
      }
      return;
    }
    if (name === 'return') {
      evt.preventDefault();
      evt.stopPropagation();
      lastPasteStart = -1;
      lastPasteLen = 0;
      if (suggestionsVisible) { applyCommandCompletion(); return; }
      if (fileSuggestionsVisible) { applyFileCompletion(); return; }
      const trimmed = value.trim();
      if (trimmed) {
        let expanded = trimmed;
        for (const [placeholder, fullText] of pastedBlocks) {
          expanded = expanded.split(placeholder).join(fullText);
        }
        pastedBlocks.clear();
        onSubmit(expanded);
        setHistory(prev => [...prev, trimmed]);
        setValue('');
        setCursor(0);
        setHistoryIdx(-1);
      }
      return;
    }
    if (name === 'tab') {
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.shift && onModeCycle) { onModeCycle(); return; }
      if (suggestionsVisible) { applyCommandCompletion(); return; }
      if (fileSuggestionsVisible) { applyFileCompletion(); return; }
      return;
    }
    if (evt.ctrl && name === 'p') {
      evt.preventDefault();
      const next = value.startsWith('/') ? '' : '/';
      setValue(next);
      setCursor(next.length);
      return;
    }
    if (evt.ctrl && name === 'c') {
      evt.preventDefault();
      evt.stopPropagation();
      const isHintText = value === 'press Ctrl+C again to exit';
      if (value && !isHintText) {
        writeClipboard(value);
        lastCtrlCEmpty = 0;
      } else {
        const now = Date.now();
        if (now - lastCtrlCEmpty < 1000) {
          if (onExit) {
            onExit();
          } else {
            process.exit(0);
          }
        } else {
          lastCtrlCEmpty = now;
          setValue('press Ctrl+C again to exit');
          setCursor(0);
          setTimeout(() => {
            setValue(prev => prev === 'press Ctrl+C again to exit' ? '' : prev);
          }, 1500);
        }
      }
      return;
    }
    if (evt.ctrl && name === 'z') {
      evt.preventDefault();
      process.stdout.write('\x1b[?2004l');
      process.kill(process.pid, 'SIGTSTP');
      return;
    }
    if (evt.ctrl && name === 'v') {
      evt.preventDefault();
      const insertAt = cursor;
      readClipboardImage().then((imgPath) => {
        if (imgPath) {
          const summary = `[image: ${imgPath}]`;
          setValue(prev => {
            lastPasteStart = insertAt;
            lastPasteLen = summary.length;
            return prev.slice(0, insertAt) + summary + prev.slice(insertAt);
          });
          setCursor(insertAt + summary.length);
          return;
        }
        return readClipboard().then((text) => {
          if (!text) return;
          const clean = text.replace(/\r\n/g, '\n').trimEnd();
          const lines = clean.split('\n');
          if (lines.length >= 2 || clean.length > 200) {
            const placeholder = `[pasted-${pastedBlocks.size + 1}]`;
            pastedBlocks.set(placeholder, clean);
            setValue(prev => prev.slice(0, insertAt) + placeholder + prev.slice(insertAt));
            setCursor(insertAt + placeholder.length);
          } else {
            setValue(prev => prev.slice(0, insertAt) + clean + prev.slice(insertAt));
            setCursor(insertAt + clean.length);
          }
        });
      }).catch(() => {});
      return;
    }
    if (name === 'backspace' || name === 'delete') {
      evt.preventDefault();
      if (cursor > 0 && lastPasteStart >= 0 && cursor === lastPasteStart + lastPasteLen) {
        setValue(value.slice(0, lastPasteStart) + value.slice(cursor));
        setCursor(lastPasteStart);
        lastPasteStart = -1;
        lastPasteLen = 0;
      } else if (cursor > 0) {
        lastPasteStart = -1;
        lastPasteLen = 0;
        setValue(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor(cursor - 1);
      }
      return;
    }
    if (name === 'left') {
      evt.preventDefault();
      setCursor(Math.max(0, cursor - 1));
      return;
    }
    if (name === 'right') {
      evt.preventDefault();
      setCursor(Math.min(value.length, cursor + 1));
      return;
    }
    if (fileSuggestionsVisible && name === 'up') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand(prev => prev <= 0 ? fileSuggestions.length - 1 : prev - 1);
      return;
    }
    if (fileSuggestionsVisible && name === 'down') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand(prev => (prev + 1) % fileSuggestions.length);
      return;
    }
    if (suggestionsVisible && name === 'up') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand(prev => prev <= 0 ? suggestions.length - 1 : prev - 1);
      return;
    }
    if (suggestionsVisible && name === 'down') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand(prev => (prev + 1) % suggestions.length);
      return;
    }
    if (!suggestionsVisible && name === 'up') {
      if (history.length === 0 || (historyIdx < 0 && value === '')) return;
      evt.preventDefault();
      evt.stopPropagation();
      const nextIdx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setValue(history[nextIdx] || '');
      setCursor((history[nextIdx] || '').length);
      return;
    }
    if (!suggestionsVisible && name === 'down') {
      if (historyIdx < 0) return;
      evt.preventDefault();
      evt.stopPropagation();
      const nextIdx = historyIdx + 1;
      if (nextIdx >= history.length) { setHistoryIdx(-1); setValue(''); setCursor(0); return; }
      setHistoryIdx(nextIdx);
      setValue(history[nextIdx] || '');
      setCursor((history[nextIdx] || '').length);
      return;
    }
    if (evt.ctrl || evt.meta) return;
    if (name === 'space' || name === ' ') {
      evt.preventDefault();
      setValue(value.slice(0, cursor) + ' ' + value.slice(cursor));
      setCursor(cursor + 1);
      return;
    }
    if (name.length === 1 && !evt.ctrl && !evt.meta) {
      const input = evt.shift ? name.toUpperCase() : name;
      setValue(value.slice(0, cursor) + input + value.slice(cursor));
      setCursor(cursor + input.length);
    }
  });

  const before = value.slice(0, cursor);
  const cursorChar = value[cursor] || ' ';
  const after = value.slice(cursor + 1);
  const homeDir = (cwd || process.cwd()).replace(/^\/root\//, '~/');

  const barLen = 8;
  const filled = Math.round((contextPct / 100) * barLen);
  const barColor = contextPct > 75 ? theme.error : contextPct > 50 ? theme.warn : theme.ok;
  const ctxBar = Array.from({ length: barLen }).map((_, i) =>
    i < filled ? '█' : '░'
  ).join('');

  if (disabled) {
    return (
      <box flexDirection="column" paddingX={2} backgroundColor={theme.bg} flexShrink={0}>
        <box
          backgroundColor={theme.bgElement}
          paddingX={2}
          paddingTop={1}
          paddingBottom={1}
          minHeight={3}
        >
          <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>{MODE_LABEL[mode]}</text>
          <text fg={theme.textMuted}>{'  '}{frame()} thinking...</text>
          <text fg={theme.textMuted}>{'  '}esc to cancel</text>
        </box>
        <box marginTop={1} paddingX={1}>
          <text fg={theme.text}>{model || 'aurix'}</text>
          <text fg={theme.textMuted}>{' · ctx '}</text>
          <text fg={barColor}>{ctxBar}</text>
          <text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text>
          <text fg={theme.border}>{' · '}</text>
          <text fg={theme.textMuted}>{homeDir}</text>
        </box>
      </box>
    );
  }

  if (home) {
    const boxWidth = Math.min(termWidth - 4, 72);
    return (
      <box flexDirection="column" alignItems="center" backgroundColor={theme.bg}>
        <box flexDirection="column" border={suggestionsVisible || fileSuggestionsVisible ? ["top", "left", "right"] : undefined} borderColor={suggestionsVisible || fileSuggestionsVisible ? theme.border : undefined} backgroundColor={theme.bgElement} width={boxWidth}>
          {suggestionsVisible && (
            <CommandSuggestions suggestions={suggestions} selected={selectedCommand} />
          )}
          {fileSuggestionsVisible && (
            <FileSuggestions files={fileSuggestions} selected={selectedCommand} />
          )}
          <box
            paddingX={2}
            paddingTop={1}
            paddingBottom={1}
            minHeight={3}
          >
            {value ? (
              <text fg={theme.text} wrapMode="word">
                <span style={{ fg: theme.text }}>{before}</span>
                <span style={{ bg: theme.cursor, fg: theme.bg }}>{cursorChar}</span>
                <span style={{ fg: theme.text }}>{after}</span>
              </text>
            ) : (
              <text fg={theme.textMuted}>Ask anything...</text>
            )}
          </box>
          <box paddingX={2} paddingBottom={1} flexDirection="row" justifyContent="flex-end">
            <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>{MODE_LABEL[mode]}</text>
            <text fg={theme.textMuted}>{'  '}</text>
            <text fg={theme.text}>{model || 'aurix'}</text>
            <text fg={theme.textMuted}>{' · ctx '}</text>
            <text fg={barColor}>{ctxBar}</text>
            <text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text>
          </box>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" paddingX={2} backgroundColor={theme.bg} flexShrink={0}>
      <box flexDirection="column" border={suggestionsVisible || fileSuggestionsVisible ? ["top", "left", "right"] : undefined} borderColor={suggestionsVisible || fileSuggestionsVisible ? theme.border : undefined} backgroundColor={theme.bgElement}>
        {suggestionsVisible && (
          <CommandSuggestions suggestions={suggestions} selected={selectedCommand} />
        )}
        {fileSuggestionsVisible && (
          <FileSuggestions files={fileSuggestions} selected={selectedCommand} />
        )}
        <box
          paddingX={2}
          paddingTop={1}
          paddingBottom={1}
          minHeight={3}
        >
          {value ? (
            <text fg={theme.text} wrapMode="word">
              <span style={{ fg: theme.text }}>{before}</span>
              <span style={{ bg: theme.cursor, fg: theme.bg }}>{cursorChar}</span>
              <span style={{ fg: theme.text }}>{after}</span>
            </text>
          ) : (
            <text fg={theme.textMuted}>Ask anything...</text>
          )}
        </box>
      </box>
      <box paddingX={1} marginTop={1} flexDirection="row" justifyContent="space-between">
        <box>
          <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>{MODE_LABEL[mode]}</text>
          <text fg={theme.textMuted}>{'  '}</text>
          <text fg={theme.text}>{model || 'aurix'}</text>
          <text fg={theme.textMuted}>{' · ctx '}</text>
          <text fg={barColor}>{ctxBar}</text>
          <text fg={theme.textMuted}>{` ${Math.round(contextPct)}%`}</text>
        </box>
        <box>
          <text fg={theme.textMuted}>{homeDir}</text>
        </box>
      </box>
      <box paddingX={1}>
        <text fg={theme.textMuted}>To Exit: Type /exit or Double Ctrl+C</text>
      </box>
    </box>
  );
}

function FileSuggestions({ files, selected }: { files: string[]; selected: number }) {
  return (
    <box flexDirection="column" paddingX={1} paddingTop={1} paddingBottom={1}>
      {files.map((file, index) => {
        const isSelected = index === selected;
        return (
          <box key={file}>
            <text
              fg={isSelected ? theme.bg : theme.primary}
              bg={isSelected ? theme.primary : undefined}
            >
              {` @${file} `}
            </text>
          </box>
        );
      })}
      <box><text fg={theme.border}>{'─'.repeat(40)}</text></box>
    </box>
  );
}

function CommandSuggestions({ suggestions, selected }: { suggestions: SlashCommand[]; selected: number }) {
  return (
    <box flexDirection="column" paddingX={1} paddingTop={1} paddingBottom={1}>
      {suggestions.map((command, index) => {
        const isSelected = index === selected;
        return (
          <box key={command.name}>
            <text
              fg={isSelected ? theme.bg : theme.primary}
              bg={isSelected ? theme.primary : undefined}
            >
              {` /${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''} `}
            </text>
            <text fg={theme.textMuted}> {command.description}</text>
          </box>
        );
      })}
      <box><text fg={theme.border}>{'─'.repeat(40)}</text></box>
    </box>
  );
}
