import chalk from 'chalk';
import readline from 'readline';
import { readClipboard, writeClipboard } from './Clipboard.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';

const teal = chalk.hex('#fab283');
const orange = chalk.hex('#9d7cd8');
const dim = chalk.hex('#808080');
const light = chalk.hex('#5c9cf5');
const green = chalk.hex('#7fd88f');
const bright = chalk.hex('#eeeeee');
const border = chalk.hex('#484848');
const bg = chalk.bgHex('#1e1e1e');

const panelBg = chalk.bgHex('#141414');
let setupScreenActive = false;

export function enterSetupScreen(): void {
  if (!process.stdout.isTTY || setupScreenActive) {
    console.clear();
    return;
  }
  setupScreenActive = true;
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
  process.once('exit', () => leaveSetupScreen());
}

export function leaveSetupScreen(): void {
  if (!process.stdout.isTTY || !setupScreenActive) return;
  setupScreenActive = false;
  process.stdout.write(
    '\x1b[?1049l\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[0m',
  );
}

function clearSetupScreen(): void {
  if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H');
  else console.clear();
}

export function drawBox(lines: string[], width = 60): void {
  const top = border('╭' + '─'.repeat(width) + '╮');
  const bot = border('╰' + '─'.repeat(width) + '╯');
  console.log(top);
  for (const line of lines) {
    const stripped = line.replace(/\u001b\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - stripped.length);
    console.log(
      border('│') + panelBg(' ' + line + ' '.repeat(pad) + ' ') + border('│'),
    );
  }
  console.log(bot);
}

export function drawInputScreen(opts: {
  title: string;
  hint: string;
  label: string;
  masked?: boolean;
  extra?: string[];
}): Promise<string> {
  return new Promise((resolve) => {
    clearSetupScreen();
    console.log();
    const titleLine = teal.bold(opts.title);
    const hintLine = dim(opts.hint);
    const lines = [titleLine, '', hintLine];
    if (opts.extra) {
      lines.push('', ...opts.extra);
    }
    drawBox(lines, 64);
    console.log();
    console.log(`  ${teal('  ' + opts.label)}`);

    const stdin = process.stdin;
    let buf = '';
    let cursor = 0; // cursor position in buf
    let selStart = -1; // selection start (-1 = no selection)
    let selEnd = -1; // selection end
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    // Enable bracketed paste so terminals that support it wrap paste
    if (process.stdout.isTTY) process.stdout.write('\x1b[?2004h');

    let escBuf = '';
    let escTimer: NodeJS.Timeout | null = null;
    const clearEscTimer = () => {
      if (escTimer) {
        clearTimeout(escTimer);
        escTimer = null;
      }
    };
    const flushEsc = () => {
      clearEscTimer();
      if (escBuf.length === 0) return;
      if (escBuf === '\x1b') {
        // Standalone Escape → go back
        escBuf = '';
        stdin.removeListener('data', onData);
        if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
        if (process.stdout.isTTY) process.stdout.write('\x1b[?2004l');
        process.stdout.write('\n');
        resolve('__back__');
        return;
      }
      // Unrecognized escape sequence — discard
      escBuf = '';
    };

    const renderLine = () => {
      const text = opts.masked ? '●'.repeat(buf.length) : buf;
      // Show cursor with underline at cursor position
      let display = '';
      for (let i = 0; i < text.length; i++) {
        const inSelection =
          selStart >= 0 &&
          selEnd >= 0 &&
          i >= Math.min(selStart, selEnd) &&
          i < Math.max(selStart, selEnd);
        if (i === cursor) {
          display += '\x1b[4m' + (text[i] || ' ') + '\x1b[24m'; // underline cursor
        } else if (inSelection) {
          display += '\x1b[7m' + text[i] + '\x1b[27m'; // reverse video for selection
        } else {
          display += text[i];
        }
      }
      if (cursor >= text.length) display += '\x1b[4m \x1b[24m'; // cursor at end
      process.stdout.write(`\r\x1b[2K  ${bg(bright(' ' + display + ' '))}   `);
    };
    renderLine();

    function onData(ch: string) {
      // Dont Change This Or You Will Make The Clipboard Corrupted
      // Handle bracketed paste arriving as a single chunk: \x1b[200~content\x1b[201~
      if (ch.includes('\x1b[200~')) {
        const startIdx = ch.indexOf('\x1b[200~') + 6;
        const endIdx = ch.indexOf('\x1b[201~', startIdx);
        if (endIdx !== -1) {
          // Full bracketed paste in one chunk — strip \r and trailing \n
          const pasted = safeDisplayText(ch.slice(startIdx, endIdx))
            .replace(/\r/g, '')
            .replace(/\n$/, '');
          buf += pasted;
          renderLine();
          return;
        } else {
          // Start marker found but no end marker yet — accumulate
          buf += safeDisplayText(ch.slice(startIdx)).replace(/\r/g, '');
          renderLine();
          // Switch to paste accumulator mode
          const onPaste = (p: string) => {
            const pEnd = p.indexOf('\x1b[201~');
            if (pEnd === -1) {
              buf += safeDisplayText(p).replace(/\r/g, '');
              renderLine();
              return;
            }
            buf += safeDisplayText(p.slice(0, pEnd))
              .replace(/\r/g, '')
              .replace(/\n$/, '');
            stdin.removeListener('data', onPaste);
            stdin.on('data', onData);
            renderLine();
          };
          stdin.removeListener('data', onData);
          stdin.on('data', onPaste);
          return;
        }
      }

      // If we're accumulating an escape sequence, keep appending.
      if (escBuf.length > 0) {
        escBuf += ch;
        // Check for bracketed paste start: ESC [ 2 0 0 ~
        if (escBuf.endsWith('\x1b[200~')) {
          clearEscTimer();
          escBuf = '';
          // Read until bracketed paste end marker
          const onPaste = (p: string) => {
            const endIdx = p.indexOf('\x1b[201~');
            if (endIdx === -1) {
              buf += safeDisplayText(p);
              renderLine();
              return;
            }
            buf += safeDisplayText(p.slice(0, endIdx));
            stdin.removeListener('data', onPaste);
            stdin.on('data', onData);
            renderLine();
          };
          stdin.removeListener('data', onData);
          stdin.on('data', onPaste);
          return;
        }
        // Check for known CSI terminators (letter or ~)
        if (/[A-Za-z~]/.test(ch)) {
          clearEscTimer();
          const seq = escBuf;
          escBuf = '';

          // Arrow keys: Left=\x1b[D, Right=\x1b[C, Home=\x1b[H, End=\x1b[F
          if (seq === '\x1b[D') {
            cursor = Math.max(0, cursor - 1);
            selStart = selEnd = -1;
            renderLine();
            return;
          } // Left
          if (seq === '\x1b[C') {
            cursor = Math.min(buf.length, cursor + 1);
            selStart = selEnd = -1;
            renderLine();
            return;
          } // Right
          if (seq === '\x1b[H') {
            cursor = 0;
            selStart = selEnd = -1;
            renderLine();
            return;
          } // Home
          if (seq === '\x1b[F') {
            cursor = buf.length;
            selStart = selEnd = -1;
            renderLine();
            return;
          } // End

          // Shift+arrows: Shift+Left=\x1b[1;2D, Shift+Right=\x1b[1;2C, Shift+Home=\x1b[1;2H, Shift+End=\x1b[1;2F
          if (seq === '\x1b[1;2D') {
            // Shift+Left
            if (selStart < 0) selStart = cursor;
            cursor = Math.max(0, cursor - 1);
            selEnd = cursor;
            renderLine();
            return;
          }
          if (seq === '\x1b[1;2C') {
            // Shift+Right
            if (selStart < 0) selStart = cursor;
            cursor = Math.min(buf.length, cursor + 1);
            selEnd = cursor;
            renderLine();
            return;
          }
          if (seq === '\x1b[1;2H') {
            // Shift+Home
            if (selStart < 0) selStart = cursor;
            cursor = 0;
            selEnd = cursor;
            renderLine();
            return;
          }
          if (seq === '\x1b[1;2F') {
            // Shift+End
            if (selStart < 0) selStart = cursor;
            cursor = buf.length;
            selEnd = cursor;
            renderLine();
            return;
          }

          // Other escape sequences — discard
          return;
        }
        // Reset timeout
        clearEscTimer();
        escTimer = setTimeout(flushEsc, 300);
        return;
      }

      const c = ch.charCodeAt(0);

      if (c === 22) {
        // Ctrl+V — paste from clipboard (raw mode sends 0x16 instead of clipboard content)
        readClipboard()
          .then((clip) => {
            if (clip) {
              buf += safeDisplayText(clip);
              cursor = buf.length;
              renderLine();
            }
          })
          .catch(() => {});
        return;
      }

      if (c === 27) {
        // Start of escape sequence — wait to see if more bytes arrive
        escBuf = ch;
        clearEscTimer();
        escTimer = setTimeout(flushEsc, 300);
        return;
      }

      if (c === 13 || c === 10) {
        clearEscTimer();
        stdin.removeListener('data', onData);
        if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
        if (process.stdout.isTTY) process.stdout.write('\x1b[?2004l');
        process.stdout.write('\n');
        resolve(buf);
        return;
      }

      if (c === 127 || c === 8) {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          renderLine();
        }
        return;
      }

      // Ctrl+C — copy the current input when available, otherwise exit.
      if (c === 3) {
        if (buf) {
          writeClipboard(buf);
          return;
        }
        stdin.removeListener('data', onData);
        if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
        if (process.stdout.isTTY) process.stdout.write('\x1b[?2004l');
        process.stdout.write('\n^C\n');
        process.exit(130);
      }

      // Ctrl+X — exit input
      if (c === 24) {
        stdin.removeListener('data', onData);
        if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
        if (process.stdout.isTTY) process.stdout.write('\x1b[?2004l');
        process.stdout.write('\n');
        resolve('__back__');
        return;
      }

      // Ctrl+U — clear line
      if (c === 21) {
        buf = '';
        renderLine();
        return;
      }

      // Accept printable chars, including multi-byte UTF-8 (pasted chunks).
      // Filter out control chars except tab (which we treat as space).
      if (c >= 32 || ch === '\t') {
        buf += ch === '\t' ? '    ' : safeDisplayText(ch);
        renderLine();
      }
    }

    stdin.on('data', onData);
  });
}

type SelectorItem = { id: string; label: string; desc?: string };

export function drawSelector(opts: {
  title: string;
  items: SelectorItem[];
  allowSkip?: boolean;
  multi: true;
  extra?: string[];
}): Promise<string[]>;
export function drawSelector(opts: {
  title: string;
  items: SelectorItem[];
  allowSkip?: boolean;
  multi?: false;
  extra?: string[];
}): Promise<string>;
export function drawSelector(opts: {
  title: string;
  items: SelectorItem[];
  allowSkip?: boolean;
  multi?: boolean;
  extra?: string[];
}): Promise<string | string[]> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let active = 0;
    const selected = new Set<string>();
    const maxIndex = opts.items.length + (opts.allowSkip ? 1 : 0) - 1;

    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    readline.emitKeypressEvents(stdin);
    enableMouse();
    // Bracketed paste — in case the user pastes while a selector is open.
    if (process.stdout.isTTY) process.stdout.write('\x1b[?2004h');

    let escBuf = '';
    let escTimer: NodeJS.Timeout | null = null;
    const clearEscTimer = () => {
      if (escTimer) {
        clearTimeout(escTimer);
        escTimer = null;
      }
    };

    const cleanup = () => {
      clearEscTimer();
      stdin.removeListener('data', onData);
      stdin.removeListener('keypress', onKeypress as any);
      disableMouse();
      if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
      if (process.stdout.isTTY) process.stdout.write('\x1b[?2004l');
      process.stdout.write('\n');
    };

    const finish = (value: string | string[]) => {
      cleanup();
      resolve(value as any);
    };

    const repaint = () => {
      clearSetupScreen();
      const lines = [teal.bold(opts.title), ''];
      if (opts.extra) {
        opts.extra.forEach((line) => lines.push(dim('  ' + line)));
        lines.push('');
      }
      opts.items.forEach((item, i) => {
        const isActive = i === active;
        const checked = opts.multi
          ? (selected.has(item.id) ? green('[x]') : dim('[ ]')) + ' '
          : '';
        const pointer = isActive ? teal('›') : dim(' ');
        const num = isActive
          ? orange.bold(String(i + 1).padStart(2))
          : orange(String(i + 1).padStart(2));
        const label = isActive ? bright.bold(item.label) : bright(item.label);
        const desc = item.desc ? dim(' -- ' + item.desc) : '';
        lines.push(`  ${pointer} ${num}  ${checked}${label}${desc}`);
      });
      if (opts.allowSkip) {
        const skipActive = active === opts.items.length;
        lines.push('');
        lines.push(
          `  ${skipActive ? teal('›') : dim(' ')} ${teal(' 0')}  ${dim('Skip for now')}`,
        );
      }
      lines.push('');
      lines.push(
        opts.multi
          ? dim(
              '  ↑/↓ or tab move · space toggle · a all · enter confirm · mouse click · esc back',
            )
          : dim('  ↑/↓ or tab move · enter confirm · mouse click · esc back'),
      );
      drawBox(lines, 76);
    };

    const move = (delta: number) => {
      active += delta;
      if (active < 0) active = maxIndex;
      if (active > maxIndex) active = 0;
      repaint();
    };

    const toggleActive = () => {
      const item = opts.items[active];
      if (!item) return;
      if (selected.has(item.id)) selected.delete(item.id);
      else selected.add(item.id);
      repaint();
    };

    const confirmActive = () => {
      if (opts.allowSkip && active === opts.items.length) {
        finish(opts.multi ? [] : '__skip__');
        return;
      }
      if (opts.multi) {
        if (selected.size === 0 && opts.items[active])
          selected.add(opts.items[active].id);
        finish(Array.from(selected));
        return;
      }
      finish(opts.items[active]?.id || '__skip__');
    };

    function onData(ch: string) {
      // Windows console arrow keys: 0x00 or 0xE0 followed by scan code
      if (ch.charCodeAt(0) === 0 || ch.charCodeAt(0) === 0xe0) {
        // Next byte will be the scan code — buffer it
        escBuf = ch;
        clearEscTimer();
        escTimer = setTimeout(() => {
          escBuf = '';
        }, 300);
        return;
      }
      if (
        escBuf.length === 1 &&
        (escBuf.charCodeAt(0) === 0 || escBuf.charCodeAt(0) === 0xe0)
      ) {
        clearEscTimer();
        const scanCode = ch.charCodeAt(0);
        escBuf = '';
        if (scanCode === 0x48 || scanCode === 0x53) {
          move(-1);
          return;
        } // Up or Page Up
        if (scanCode === 0x50 || scanCode === 0x51) {
          move(1);
          return;
        } // Down or Page Down
        return; // Other Windows keys — ignore
      }

      // Continuing an escape sequence (arrow keys, mouse, bracketed paste)
      if (escBuf.length > 0) {
        escBuf += ch;
        // Bracketed paste start — swallow paste content so it doesn't
        // accidentally toggle items or trigger number keys.
        if (escBuf.endsWith('\x1b[200~')) {
          clearEscTimer();
          escBuf = '';
          const onPaste = (p: string) => {
            if (p.indexOf('\x1b[201~') === -1) return;
            stdin.removeListener('data', onPaste);
            stdin.on('data', onData);
          };
          stdin.removeListener('data', onData);
          stdin.on('data', onPaste);
          return;
        }
        // Arrow keys
        if (escBuf === '\x1b[A') {
          clearEscTimer();
          escBuf = '';
          move(-1);
          return;
        }
        if (escBuf === '\x1b[B') {
          clearEscTimer();
          escBuf = '';
          move(1);
          return;
        }
        if (escBuf === '\x1b[Z') {
          clearEscTimer();
          escBuf = '';
          move(-1);
          return;
        }
        // Mouse report: ESC < params M/m
        const mouseMatch = /\x1b\[<(\d+);(\d+);(\d+)([mM])/.exec(escBuf);
        if (mouseMatch) {
          clearEscTimer();
          escBuf = '';
          const mouse = {
            x: Number(mouseMatch[2]),
            y: Number(mouseMatch[3]),
            action:
              mouseMatch[4] === 'M' ? ('press' as const) : ('release' as const),
          };
          if (mouse.action === 'press') {
            const itemRowStart = 5;
            const idx = mouse.y - itemRowStart;
            if (idx >= 0 && idx < opts.items.length) {
              active = idx;
              if (opts.multi) toggleActive();
              else confirmActive();
            }
            if (
              opts.allowSkip &&
              mouse.y === itemRowStart + opts.items.length + 1
            ) {
              active = opts.items.length;
              confirmActive();
            }
            repaint();
          }
          return;
        }
        // If we got a CSI terminator, consume the sequence silently.
        if (/[A-Za-z~]/.test(ch)) {
          clearEscTimer();
          escBuf = '';
          return;
        }
        clearEscTimer();
        escTimer = setTimeout(() => {
          // Timed out mid-sequence — not a standalone Esc, just drop it.
          escBuf = '';
        }, 300);
        return;
      }

      const c = ch.charCodeAt(0);

      if (c === 27) {
        // Could be standalone Esc (back) or start of a sequence.
        // Buffer and decide after 300ms (increased for slow terminals/SSH).
        escBuf = ch;
        clearEscTimer();
        escTimer = setTimeout(() => {
          if (escBuf === '\x1b') {
            escBuf = '';
            finish('__back__');
          } else {
            escBuf = '';
          }
        }, 300);
        return;
      }

      if (c === 13 || c === 10) {
        confirmActive();
        return;
      }

      if (ch === '\t') {
        move(1);
        return;
      }

      if (c === 3) process.exit(0);

      if (opts.multi && ch === ' ') {
        toggleActive();
        return;
      }

      if (opts.multi && ch.toLowerCase() === 'a') {
        if (selected.size === opts.items.length) selected.clear();
        else opts.items.forEach((item) => selected.add(item.id));
        repaint();
        return;
      }

      if (ch === 'k') {
        move(-1);
        return;
      }
      if (ch === 'j') {
        move(1);
        return;
      }

      if (/[0-9]/.test(ch)) {
        if (ch === '0' && opts.allowSkip) {
          active = opts.items.length;
          confirmActive();
          return;
        }
        const idx = parseInt(ch, 10) - 1;
        if (idx >= 0 && idx < opts.items.length) {
          active = idx;
          if (opts.multi) toggleActive();
          else confirmActive();
        }
      }
    }

    // Cross-platform keypress handler (arrow keys work on Windows/Linux/macOS)
    const onKeypress = (
      _ch: string | undefined,
      key: readline.Key | undefined,
    ) => {
      if (!key) return;
      if (key.name === 'up') {
        move(-1);
        return;
      }
      if (key.name === 'down') {
        move(1);
        return;
      }
      if (key.name === 'pageup') {
        move(-1);
        return;
      }
      if (key.name === 'pagedown') {
        move(1);
        return;
      }
    };

    repaint();
    stdin.on('keypress', onKeypress);
    stdin.on('data', onData);
  });
}

export function drawSearchableSelector(opts: {
  title: string;
  items: SelectorItem[];
  extra?: string[];
  maxVisible?: number;
}): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let query = '';
    let active = 0;
    const maxVisible = Math.max(5, opts.maxVisible || Math.min(16, Math.max(7, (process.stdout.rows || 24) - 12)));

    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    readline.emitKeypressEvents(stdin);

    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const score = (item: SelectorItem): number => {
      const needle = normalize(query);
      const haystack = normalize(`${item.id} ${item.label} ${item.desc || ''}`);
      if (!needle) return 0;
      if (haystack.startsWith(needle)) return -200;
      const direct = haystack.indexOf(needle);
      if (direct >= 0) return -100 + direct;
      let cursor = 0;
      let gaps = 0;
      for (const char of needle) {
        const found = haystack.indexOf(char, cursor);
        if (found < 0) return Number.POSITIVE_INFINITY;
        gaps += found - cursor;
        cursor = found + 1;
      }
      return gaps + 100;
    };
    const filtered = () => opts.items
      .map((item) => ({ item, score: score(item) }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => a.score - b.score)
      .map((entry) => entry.item);

    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress as any);
      if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
      process.stdout.write('\n');
    };
    const finish = (value: string) => {
      cleanup();
      resolve(value);
    };
    const repaint = () => {
      const items = filtered();
      active = Math.max(0, Math.min(active, Math.max(0, items.length - 1)));
      const start = Math.max(0, Math.min(active - Math.floor(maxVisible / 2), Math.max(0, items.length - maxVisible)));
      const visible = items.slice(start, start + maxVisible);
      clearSetupScreen();
      const lines = [teal.bold(opts.title), ''];
      opts.extra?.forEach((line) => lines.push(dim('  ' + line)));
      if (opts.extra?.length) lines.push('');
      lines.push(`  ${dim('Search:')} ${bright(query)}${teal('█')}  ${dim(`${items.length}/${opts.items.length}`)}`);
      lines.push('');
      if (visible.length === 0) lines.push(dim('  No matching models.'));
      visible.forEach((item, index) => {
        const itemIndex = start + index;
        const isActive = itemIndex === active;
        const pointer = isActive ? teal('›') : dim(' ');
        const label = isActive ? bright.bold(item.label) : bright(item.label);
        const desc = item.desc ? dim(' -- ' + item.desc) : '';
        lines.push(`  ${pointer} ${label}${desc}`);
      });
      lines.push('');
      lines.push(dim('  type to search · ↑/↓ navigate · PgUp/PgDn · Home/End · enter select · esc back'));
      drawBox(lines, 76);
    };
    const move = (delta: number) => {
      const length = filtered().length;
      if (!length) return;
      active = (active + delta + length) % length;
      repaint();
    };
    function onKeypress(ch: string | undefined, key: readline.Key | undefined) {
      if (!key) return;
      if (key.ctrl && key.name === 'c') process.exit(0);
      if (key.name === 'escape') {
        if (query) {
          query = '';
          active = 0;
          repaint();
        } else finish('__back__');
        return;
      }
      if (key.name === 'up' || (key.ctrl && key.name === 'p')) return move(-1);
      if (key.name === 'down' || (key.ctrl && key.name === 'n')) return move(1);
      if (key.name === 'pageup') return move(-maxVisible);
      if (key.name === 'pagedown') return move(maxVisible);
      if (key.name === 'home') {
        active = 0;
        repaint();
        return;
      }
      if (key.name === 'end') {
        active = Math.max(0, filtered().length - 1);
        repaint();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        const item = filtered()[active];
        if (item) finish(item.id);
        return;
      }
      if (key.name === 'backspace') {
        query = query.slice(0, -1);
        active = 0;
        repaint();
        return;
      }
      if (key.ctrl && key.name === 'u') {
        query = '';
        active = 0;
        repaint();
        return;
      }
      const sequence = key.sequence || ch || '';
      if (sequence.length === 1 && !key.ctrl && !key.meta && sequence >= ' ' && sequence !== '\x7f') {
        query += sequence;
        active = 0;
        repaint();
      }
    }

    repaint();
    stdin.on('keypress', onKeypress);
  });
}

function enableMouse(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[?1000h\x1b[?1006h');
}

function disableMouse(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[?1000l\x1b[?1006l');
}

function parseMouse(
  input: string,
): { x: number; y: number; action: 'press' | 'release' } | null {
  const match = /\x1b\[<(\d+);(\d+);(\d+)([mM])/.exec(input);
  if (!match) return null;
  return {
    x: Number(match[2]),
    y: Number(match[3]),
    action: match[4] === 'M' ? 'press' : 'release',
  };
}

export function drawConfirm(opts: {
  title: string;
  message: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    console.log();
    const lines = [
      teal.bold(opts.title),
      '',
      bright(opts.message),
      '',
      `  ${green('y')} ${dim('Yes')}    ${orange('n')} ${dim('No')}`,
    ];
    drawBox(lines, 64);
    console.log();

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function onData(ch: string) {
      const c = ch.charCodeAt(0);
      if (c === 3) process.exit(0);
      if (c === 13 || c === 10) return;
      stdin.removeListener('data', onData);
      if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
      const yes = ch.toLowerCase() === 'y' || c === 13;
      process.stdout.write(`  ${yes ? green('Yes') : orange('No')}\n`);
      resolve(yes);
    }

    stdin.on('data', onData);
  });
}

export function drawSuccess(msg: string): void {
  console.log(`  ${green('✓')} ${msg}`);
}

export function drawInfo(msg: string): void {
  console.log(`  ${teal('›')} ${msg}`);
}

export function drawWarning(msg: string): void {
  console.log(`  ${orange('!')} ${msg}`);
}
