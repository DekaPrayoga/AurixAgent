import React, { useEffect, useMemo, useState } from 'react';
import { TextAttributes, decodePasteBytes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions, usePaste } from '@opentui/react';
import { execFile, execFileSync, spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { theme } from './theme.js';
import type { SlashCommand } from './commands.js';
import { completeCommand, filterSlashCommands } from './commands.js';
import { filterFiles } from './fileList.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';

function runCmd(
  cmd: string,
  args: string[],
  input?: string,
  env?: Record<string, string>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { timeout: 2000, env: env ? { ...process.env, ...env } : undefined },
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

export function readClipboard(): Promise<string | undefined> {
  return (async () => {
    if (isMac) {
      try {
        const t = await runCmd('pbpaste', []);
        if (t) return t;
      } catch {}
      return undefined;
    }
    if (isWindows) {
      try {
        const t = await runCmd('powershell.exe', [
          '-NoProfile',
          '-Sta',
          '-command',
          '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $clip = Get-Clipboard -Raw; if ($clip -ne $null) { Write-Output $clip }',
        ]);
        if (t) return t.replace(/\r\n/g, '\n');
      } catch {}
      return undefined;
    }
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

export function writeClipboard(text: string): void {
  const b64 = Buffer.from(text).toString('base64');
  const osc52 = `\x1b]52;c;${b64}\x07`;
  process.stdout.write(process.env.TMUX ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52);

  import('node:child_process')
    .then(({ spawn }) => {
      const clipEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
      if (process.env.DISPLAY) clipEnv.DISPLAY = process.env.DISPLAY;
      if (process.env.XAUTHORITY) clipEnv.XAUTHORITY = process.env.XAUTHORITY;
      const tools: [string, string[]][] = [
        ['wl-copy', []],
        ['xclip', ['-selection', 'clipboard']],
        ['xsel', ['--clipboard', '--input']],
        ['pbcopy', []],
        ['clip', []],
        ['clip.exe', []],
      ];
      for (const [cmd, args] of tools) {
        try {
          const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'], env: clipEnv });
          child.stdin?.end(text);
          child.on('error', () => {});
        } catch {}
      }
    })
    .catch(() => {});
}

function readClipboardImage(): Promise<string | undefined> {
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
        const psScript = `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img -ne $null) { $img.Save('${tmpFileWin.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png); Write-Output 'ok' } else { Write-Output '' }`;
        const child = sp('powershell', ['-NoProfile', '-Command', psScript], {
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

interface InputBoxProps {
  onSubmit: (value: string) => void;
  disabled: boolean;
  commands?: SlashCommand[];
  home?: boolean;
  model?: string;
  contextPct?: number;
  cwd?: string;
  mode?: 'auto' | 'ask' | 'deny';
  onModeCycle?: () => void;
  onExit?: () => void;
  onRewind?: () => boolean;
}

const MODE_LABEL: Record<'auto' | 'ask' | 'deny', string> = {
  auto: 'Auto',
  ask: 'Ask',
  deny: 'Deny',
};
const MODE_COLOR: Record<'auto' | 'ask' | 'deny', string> = {
  auto: theme.ok,
  ask: theme.secondary,
  deny: theme.error,
};

const MAX_VISIBLE_SUGGESTIONS = 8;

let pasteInProgress = false;
let lastPasteStart = -1;
let lastPasteLen = 0;
let lastCtrlCEmpty = 0;
const pastedBlocks = new Map<string, string>();

export function InputBox({
  onSubmit,
  disabled,
  commands = [],
  home = false,
  model,
  contextPct = 0,
  cwd,
  mode = 'auto',
  onModeCycle,
  onExit,
  onRewind,
}: InputBoxProps) {
  const { width: termWidth } = useTerminalDimensions();

  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const cursorRef = React.useRef(0);
  const valueRef = React.useRef('');

  React.useEffect(() => {
    cursorRef.current = cursor;
    valueRef.current = value;
  }, [cursor, value]);
  const [selStart, setSelStart] = useState(-1);
  const [selEnd, setSelEnd] = useState(-1);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [spinnerTick, setSpinnerTick] = useState(0);
  const lastEscRef = React.useRef<number>(0);

  // Only animate spinner when input is disabled — avoids render contention
  // with keystrokes during normal typing (was causing ~500ms input lag)
  useEffect(() => {
    if (!disabled) return;
    const id = setInterval(() => setSpinnerTick((n) => n + 1), 530);
    return () => clearInterval(id);
  }, [disabled]);

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
    const text = safeDisplayText(decodePasteBytes(event.bytes)).replace(/\r\n/g, '\n').trimEnd();
    pasteInProgress = false;

    if (text) {
      const lines = text.split('\n');
      // If there's a selection, replace it with pasted text
      if (selStart >= 0 && selEnd >= 0 && selStart !== selEnd) {
        const start = Math.min(selStart, selEnd);
        const end = Math.max(selStart, selEnd);
        if (lines.length >= 2 || text.length > 200) {
          const placeholder = `[pasted-${pastedBlocks.size + 1}]`;
          pastedBlocks.set(placeholder, text);
          setValue((prev) => prev.slice(0, start) + placeholder + prev.slice(end));
          setCursor(start + placeholder.length);
        } else {
          setValue((prev) => prev.slice(0, start) + text + prev.slice(end));
          setCursor(start + text.length);
        }
        setSelStart(-1);
        setSelEnd(-1);
      } else if (lines.length >= 2 || text.length > 200) {
        const placeholder = `[pasted-${pastedBlocks.size + 1}]`;
        pastedBlocks.set(placeholder, text);
        setValue((prev) => prev + placeholder);
        setCursor((prev) => prev + placeholder.length);
      } else {
        setValue((prev) => prev + text);
        setCursor((prev) => prev + text.length);
      }
    }
  });

  const frame = () => {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return frames[spinnerTick % frames.length];
  };

  const commandQuery = value.startsWith('/') && !/\s/.test(value.slice(1)) ? value.slice(1) : null;

  const suggestions = useMemo(() => {
    if (commandQuery === null || commands.length === 0) return [];
    return filterSlashCommands(commands, commandQuery, commands.length);
  }, [commandQuery, commands]);

  const suggestionsVisible = suggestions.length > 0;
  useEffect(() => {
    setSelectedCommand(0);
  }, [commandQuery]);

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
  useEffect(() => {
    setSelectedCommand(0);
  }, [atQuery]);

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
    const name = evt.name;

    // ESC must always propagate to App.tsx for interrupt handling
    if (name === 'escape') {
      return; // Don't preventDefault, don't handle - let App.tsx handle it
    }

    if (disabled || pasteInProgress) return;

    if (name === 'return') {
      evt.preventDefault();
      evt.stopPropagation();
      lastPasteStart = -1;
      lastPasteLen = 0;
      if (suggestionsVisible) {
        applyCommandCompletion();
        return;
      }
      if (fileSuggestionsVisible) {
        applyFileCompletion();
        return;
      }
      const trimmed = value.trim();
      if (trimmed) {
        let expanded = trimmed;
        for (const [placeholder, fullText] of pastedBlocks) {
          expanded = expanded.split(placeholder).join(fullText);
        }
        pastedBlocks.clear();
        onSubmit(expanded);
        setHistory((prev) => [...prev, trimmed]);
        setValue('');
        setCursor(0);
        setHistoryIdx(-1);
      }
      return;
    }
    if (name === 'tab') {
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.shift && onModeCycle) {
        onModeCycle();
        return;
      }
      if (suggestionsVisible) {
        applyCommandCompletion();
        return;
      }
      if (fileSuggestionsVisible) {
        applyFileCompletion();
        return;
      }
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
      // Copy selected text or all text
      if (selStart >= 0 && selEnd >= 0 && selStart !== selEnd) {
        const start = Math.min(selStart, selEnd);
        const end = Math.max(selStart, selEnd);
        writeClipboard(value.slice(start, end));
      } else if (value && value !== 'press Ctrl+C again to exit') {
        writeClipboard(value);
      }
      const isHintText = value === 'press Ctrl+C again to exit';
      if (!value || isHintText) {
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
          setSelStart(-1);
          setSelEnd(-1);
          setTimeout(() => {
            setValue((prev) => (prev === 'press Ctrl+C again to exit' ? '' : prev));
          }, 1500);
        }
      }
      return;
    }
    if (evt.ctrl && name === 'a') {
      evt.preventDefault();
      setSelStart(0);
      setSelEnd(value.length);
      setCursor(value.length);
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
      readClipboardImage()
        .then((imgPath) => {
          if (imgPath) {
            const summary = `[image: ${imgPath}]`;
            setValue((prev) => {
              lastPasteStart = insertAt;
              lastPasteLen = summary.length;
              return prev.slice(0, insertAt) + summary + prev.slice(insertAt);
            });
            setCursor(insertAt + summary.length);
            return;
          }
          return readClipboard().then((text) => {
            if (!text) return;
            const clean = safeDisplayText(text).replace(/\r\n/g, '\n').trimEnd();
            const lines = clean.split('\n');
            if (lines.length >= 2 || clean.length > 200) {
              const placeholder = `[pasted-${pastedBlocks.size + 1}]`;
              pastedBlocks.set(placeholder, clean);
              setValue((prev) => prev.slice(0, insertAt) + placeholder + prev.slice(insertAt));
              setCursor(insertAt + placeholder.length);
            } else {
              setValue((prev) => prev.slice(0, insertAt) + clean + prev.slice(insertAt));
              setCursor(insertAt + clean.length);
            }
          });
        })
        .catch(() => {});
      return;
    }
    if (name === 'backspace' || name === 'delete') {
      evt.preventDefault();
      if (selStart >= 0 && selEnd >= 0 && selStart !== selEnd) {
        // Delete selected text
        const start = Math.min(selStart, selEnd);
        const end = Math.max(selStart, selEnd);
        setValue(value.slice(0, start) + value.slice(end));
        setCursor(start);
        setSelStart(-1);
        setSelEnd(-1);
        lastPasteStart = -1;
        lastPasteLen = 0;
      } else if (cursor > 0 && lastPasteStart >= 0 && cursor === lastPasteStart + lastPasteLen) {
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
      if (evt.shift) {
        // Shift+Left: extend selection left
        if (selStart < 0) setSelStart(cursor);
        const newCursor = Math.max(0, cursor - 1);
        setCursor(newCursor);
        setSelEnd(newCursor);
      } else {
        setCursor(Math.max(0, cursor - 1));
        setSelStart(-1);
        setSelEnd(-1);
      }
      return;
    }
    if (name === 'right') {
      evt.preventDefault();
      if (evt.shift) {
        // Shift+Right: extend selection right
        if (selStart < 0) setSelStart(cursor);
        const newCursor = Math.min(value.length, cursor + 1);
        setCursor(newCursor);
        setSelEnd(newCursor);
      } else {
        setCursor(Math.min(value.length, cursor + 1));
        setSelStart(-1);
        setSelEnd(-1);
      }
      return;
    }
    if (name === 'home') {
      evt.preventDefault();
      if (evt.shift) {
        if (selStart < 0) setSelStart(cursor);
        setCursor(0);
        setSelEnd(0);
      } else {
        setCursor(0);
        setSelStart(-1);
        setSelEnd(-1);
      }
      return;
    }
    if (name === 'end') {
      evt.preventDefault();
      if (evt.shift) {
        if (selStart < 0) setSelStart(cursor);
        setCursor(value.length);
        setSelEnd(value.length);
      } else {
        setCursor(value.length);
        setSelStart(-1);
        setSelEnd(-1);
      }
      return;
    }
    if (fileSuggestionsVisible && name === 'up') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand((prev) => (prev <= 0 ? fileSuggestions.length - 1 : prev - 1));
      return;
    }
    if (fileSuggestionsVisible && name === 'down') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand((prev) => (prev + 1) % fileSuggestions.length);
      return;
    }
    if (suggestionsVisible && name === 'up') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
      return;
    }
    if (suggestionsVisible && name === 'down') {
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedCommand((prev) => (prev + 1) % suggestions.length);
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
      if (nextIdx >= history.length) {
        setHistoryIdx(-1);
        setValue('');
        setCursor(0);
        return;
      }
      setHistoryIdx(nextIdx);
      setValue(history[nextIdx] || '');
      setCursor((history[nextIdx] || '').length);
      return;
    }
    if (evt.ctrl || evt.meta) return;
    if (name === 'space' || name === ' ') {
      evt.preventDefault();
      if (selStart >= 0 && selEnd >= 0 && selStart !== selEnd) {
        const start = Math.min(selStart, selEnd);
        const end = Math.max(selStart, selEnd);
        setValue(value.slice(0, start) + ' ' + value.slice(end));
        setCursor(start + 1);
        setSelStart(-1);
        setSelEnd(-1);
      } else {
        setValue(value.slice(0, cursor) + ' ' + value.slice(cursor));
        setCursor(cursor + 1);
        setSelStart(-1);
        setSelEnd(-1);
      }
      return;
    }
    if (name.length === 1 && !evt.ctrl && !evt.meta) {
      const input = evt.shift ? name.toUpperCase() : name;
      if (selStart >= 0 && selEnd >= 0 && selStart !== selEnd) {
        // Replace selected text
        const start = Math.min(selStart, selEnd);
        const end = Math.max(selStart, selEnd);
        setValue(value.slice(0, start) + input + value.slice(end));
        setCursor(start + input.length);
        setSelStart(-1);
        setSelEnd(-1);
      } else {
        setValue(value.slice(0, cursor) + input + value.slice(cursor));
        setCursor(cursor + input.length);
        setSelStart(-1);
        setSelEnd(-1);
      }
    }
  });

  // Compute before/cursor/after with selection highlighting
  const hasSelection = selStart >= 0 && selEnd >= 0 && selStart !== selEnd;
  const selFrom = hasSelection ? Math.min(selStart!, selEnd!) : -1;
  const selTo = hasSelection ? Math.max(selStart!, selEnd!) : -1;

  let beforeText = '';
  let selectedText = '';
  let afterText = '';
  if (hasSelection) {
    beforeText = value.slice(0, selFrom);
    selectedText = value.slice(selFrom, selTo);
    afterText = value.slice(selTo);
  } else {
    beforeText = value.slice(0, cursor);
    afterText = value.slice(cursor + 1);
  }
  const cursorChar = value[cursor] || ' ';
  const after = value.slice(cursor + 1);
  const homeDir = (cwd || process.cwd()).replace(/^\/root\//, '~/');

  const barLen = 8;
  const filled = Math.round((contextPct / 100) * barLen);
  const barColor = contextPct > 75 ? theme.error : contextPct > 50 ? theme.warn : theme.ok;
  const ctxBar = Array.from({ length: barLen })
    .map((_, i) => (i < filled ? '█' : '░'))
    .join('');

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
          <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>
            {MODE_LABEL[mode]}
          </text>
          <text fg={theme.textMuted}>
            {'  '}
            {frame()} thinking...
          </text>
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
        <box
          flexDirection="column"
          border={
            suggestionsVisible || fileSuggestionsVisible ? ['top', 'left', 'right'] : undefined
          }
          borderColor={suggestionsVisible || fileSuggestionsVisible ? theme.border : undefined}
          backgroundColor={theme.bgElement}
          width={boxWidth}
        >
          {suggestionsVisible && (
            <CommandSuggestions suggestions={suggestions} selected={selectedCommand} />
          )}
          {fileSuggestionsVisible && (
            <FileSuggestions files={fileSuggestions} selected={selectedCommand} />
          )}
          <box paddingX={2} paddingTop={1} paddingBottom={1} minHeight={3}>
            {value ? (
              <text fg={theme.text} wrapMode="word">
                <span style={{ fg: theme.text }}>{beforeText}</span>
                {hasSelection ? (
                  <span style={{ bg: theme.cursor, fg: theme.bg }}>{selectedText}</span>
                ) : (
                  <span style={{ bg: theme.cursor, fg: theme.bg }}>{cursorChar}</span>
                )}
                <span style={{ fg: theme.text }}>{afterText}</span>
              </text>
            ) : (
              <text fg={theme.textMuted}>Ask anything...</text>
            )}
          </box>
          <box paddingX={2} paddingBottom={1} flexDirection="row" justifyContent="flex-end">
            <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>
              {MODE_LABEL[mode]}
            </text>
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
      <box
        flexDirection="column"
        border={suggestionsVisible || fileSuggestionsVisible ? ['top', 'left', 'right'] : undefined}
        borderColor={suggestionsVisible || fileSuggestionsVisible ? theme.border : undefined}
        backgroundColor={theme.bgElement}
      >
        {suggestionsVisible && (
          <CommandSuggestions suggestions={suggestions} selected={selectedCommand} />
        )}
        {fileSuggestionsVisible && (
          <FileSuggestions files={fileSuggestions} selected={selectedCommand} />
        )}
        <box paddingX={2} paddingTop={1} paddingBottom={1} minHeight={3}>
          {value ? (
            <text fg={theme.text} wrapMode="word">
              <span style={{ fg: theme.text }}>{beforeText}</span>
              {hasSelection ? (
                <span style={{ bg: theme.cursor, fg: theme.bg }}>{selectedText}</span>
              ) : (
                <span style={{ bg: theme.cursor, fg: theme.bg }}>{cursorChar}</span>
              )}
              <span style={{ fg: theme.text }}>{afterText}</span>
            </text>
          ) : (
            <text fg={theme.textMuted}>Ask anything...</text>
          )}
        </box>
      </box>
      <box paddingX={1} marginTop={1} flexDirection="row" justifyContent="space-between">
        <box>
          <text fg={MODE_COLOR[mode]} attributes={TextAttributes.BOLD}>
            {MODE_LABEL[mode]}
          </text>
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
  const start = Math.max(
    0,
    Math.min(
      selected - Math.floor(MAX_VISIBLE_SUGGESTIONS / 2),
      Math.max(0, files.length - MAX_VISIBLE_SUGGESTIONS)
    )
  );
  const visible = files.slice(start, start + MAX_VISIBLE_SUGGESTIONS);

  return (
    <box flexDirection="column" paddingX={1} paddingTop={1} paddingBottom={1}>
      {visible.map((file, offset) => {
        const index = start + offset;
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
      <box>
        <text fg={theme.border}>
          {'─'.repeat(40)} {files.length > visible.length ? `${selected + 1}/${files.length}` : ''}
        </text>
      </box>
    </box>
  );
}

function CommandSuggestions({
  suggestions,
  selected,
}: {
  suggestions: SlashCommand[];
  selected: number;
}) {
  const start = Math.max(
    0,
    Math.min(
      selected - Math.floor(MAX_VISIBLE_SUGGESTIONS / 2),
      Math.max(0, suggestions.length - MAX_VISIBLE_SUGGESTIONS)
    )
  );
  const visible = suggestions.slice(start, start + MAX_VISIBLE_SUGGESTIONS);

  return (
    <box flexDirection="column" paddingX={1} paddingTop={1} paddingBottom={1}>
      {visible.map((command, offset) => {
        const index = start + offset;
        const isSelected = index === selected;
        return (
          <box key={command.name}>
            <text
              fg={isSelected ? theme.bg : theme.primary}
              bg={isSelected ? theme.primary : undefined}
            >
              {` /${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''} `}
            </text>
            <text fg={theme.textMuted}> {safeDisplayText(command.description)}</text>
          </box>
        );
      })}
      <box>
        <text fg={theme.border}>
          {'─'.repeat(40)}{' '}
          {suggestions.length > visible.length ? `${selected + 1}/${suggestions.length}` : ''}
        </text>
      </box>
    </box>
  );
}
