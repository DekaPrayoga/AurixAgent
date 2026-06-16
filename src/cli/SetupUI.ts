import chalk from 'chalk';

const teal = chalk.hex('#fab283');
const orange = chalk.hex('#9d7cd8');
const dim = chalk.hex('#808080');
const light = chalk.hex('#5c9cf5');
const green = chalk.hex('#7fd88f');
const bright = chalk.hex('#eeeeee');
const border = chalk.hex('#484848');
const bg = chalk.bgHex('#1e1e1e');

const panelBg = chalk.bgHex('#141414');

export function drawBox(lines: string[], width = 60): void {
  const top = border('╭' + '─'.repeat(width) + '╮');
  const bot = border('╰' + '─'.repeat(width) + '╯');
  console.log(top);
  for (const line of lines) {
    const stripped = line.replace(/\u001b\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - stripped.length);
    console.log(border('│') + panelBg(' ' + line + ' '.repeat(pad) + ' ') + border('│'));
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
  return new Promise(resolve => {
    console.log();
    const titleLine = teal.bold(opts.title);
    const hintLine = dim(opts.hint);
    const lines = [
      titleLine,
      '',
      hintLine,
    ];
    if (opts.extra) {
      lines.push('', ...opts.extra);
    }
    drawBox(lines, 64);
    console.log();
    console.log(`  ${teal('  ' + opts.label)}`);

    const stdin = process.stdin;
    let buf = '';
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    // Enable bracketed paste so terminals that support it wrap paste
    // content in ESC[200~ ... ESC[201~, even when raw mode is on.
    if (process.stdout.isTTY) process.stdout.write('\x1b[?2004h');

    let escBuf = '';
    let escTimer: NodeJS.Timeout | null = null;
    const clearEscTimer = () => {
      if (escTimer) { clearTimeout(escTimer); escTimer = null; }
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
      const display = opts.masked ? '●'.repeat(buf.length) : buf;
      process.stdout.write(`\r\x1b[2K  ${bg(bright(' ' + display + ' '))}   `);
    };
    renderLine();

    function onData(ch: string) {
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
              buf += p;
              renderLine();
              return;
            }
            buf += p.slice(0, endIdx);
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
          // Arrow keys, etc. — ignore (not useful for text input)
          clearEscTimer();
          escBuf = '';
          return;
        }
        // Reset timeout
        clearEscTimer();
        escTimer = setTimeout(flushEsc, 50);
        return;
      }

      const c = ch.charCodeAt(0);

      if (c === 27) {
        // Start of escape sequence — wait to see if more bytes arrive
        escBuf = ch;
        clearEscTimer();
        escTimer = setTimeout(flushEsc, 50);
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

      if (c === 3) process.exit(0);

      // Ctrl+U — clear line
      if (c === 21) {
        buf = '';
        renderLine();
        return;
      }

      // Accept printable chars, including multi-byte UTF-8 (pasted chunks).
      // Filter out control chars except tab (which we treat as space).
      if (c >= 32 || ch === '\t') {
        buf += ch === '\t' ? '    ' : ch;
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
}): Promise<string[]>;
export function drawSelector(opts: {
  title: string;
  items: SelectorItem[];
  allowSkip?: boolean;
  multi?: false;
}): Promise<string>;
export function drawSelector(opts: {
  title: string;
  items: SelectorItem[];
  allowSkip?: boolean;
  multi?: boolean;
}): Promise<string | string[]> {
  return new Promise(resolve => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let active = 0;
    const selected = new Set<string>();
    const maxIndex = opts.items.length + (opts.allowSkip ? 1 : 0) - 1;

    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    enableMouse();
    // Bracketed paste — in case the user pastes while a selector is open.
    if (process.stdout.isTTY) process.stdout.write('\x1b[?2004h');

    let escBuf = '';
    let escTimer: NodeJS.Timeout | null = null;
    const clearEscTimer = () => {
      if (escTimer) { clearTimeout(escTimer); escTimer = null; }
    };

    const cleanup = () => {
      clearEscTimer();
      stdin.removeListener('data', onData);
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
      console.clear();
      const lines = [teal.bold(opts.title), ''];
      opts.items.forEach((item, i) => {
        const isActive = i === active;
        const checked = opts.multi ? (selected.has(item.id) ? green('[x]') : dim('[ ]')) + ' ' : '';
        const pointer = isActive ? teal('›') : dim(' ');
        const num = isActive ? orange.bold(String(i + 1).padStart(2)) : orange(String(i + 1).padStart(2));
        const label = isActive ? bright.bold(item.label) : bright(item.label);
        const desc = item.desc ? dim(' -- ' + item.desc) : '';
        lines.push(`  ${pointer} ${num}  ${checked}${label}${desc}`);
      });
      if (opts.allowSkip) {
        const skipActive = active === opts.items.length;
        lines.push('');
        lines.push(`  ${skipActive ? teal('›') : dim(' ')} ${teal(' 0')}  ${dim('Skip for now')}`);
      }
      lines.push('');
      lines.push(opts.multi
        ? dim('  ↑/↓ or tab move · space toggle · a all · enter confirm · mouse click · esc back')
        : dim('  ↑/↓ or tab move · enter confirm · mouse click · esc back'));
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
        if (selected.size === 0 && opts.items[active]) selected.add(opts.items[active].id);
        finish(Array.from(selected));
        return;
      }
      finish(opts.items[active]?.id || '__skip__');
    };

    function onData(ch: string) {
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
        if (escBuf === '\x1b[A') { clearEscTimer(); escBuf = ''; move(-1); return; }
        if (escBuf === '\x1b[B') { clearEscTimer(); escBuf = ''; move(1); return; }
        if (escBuf === '\x1b[Z') { clearEscTimer(); escBuf = ''; move(-1); return; }
        // Mouse report: ESC < params M/m
        const mouseMatch = /\x1b\[<(\d+);(\d+);(\d+)([mM])/.exec(escBuf);
        if (mouseMatch) {
          clearEscTimer();
          escBuf = '';
          const mouse = { x: Number(mouseMatch[2]), y: Number(mouseMatch[3]), action: mouseMatch[4] === 'M' ? 'press' as const : 'release' as const };
          if (mouse.action === 'press') {
            const itemRowStart = 5;
            const idx = mouse.y - itemRowStart;
            if (idx >= 0 && idx < opts.items.length) {
              active = idx;
              if (opts.multi) toggleActive();
              else confirmActive();
            }
            if (opts.allowSkip && mouse.y === itemRowStart + opts.items.length + 1) {
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
        }, 50);
        return;
      }

      const c = ch.charCodeAt(0);

      if (c === 27) {
        // Could be standalone Esc (back) or start of a sequence.
        // Buffer and decide after 50ms.
        escBuf = ch;
        clearEscTimer();
        escTimer = setTimeout(() => {
          if (escBuf === '\x1b') {
            escBuf = '';
            finish('__back__');
          } else {
            escBuf = '';
          }
        }, 50);
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
        else opts.items.forEach(item => selected.add(item.id));
        repaint();
        return;
      }

      if (ch === 'k') { move(-1); return; }
      if (ch === 'j') { move(1); return; }

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

    repaint();
    stdin.on('data', onData);
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

function parseMouse(input: string): { x: number; y: number; action: 'press' | 'release' } | null {
  const match = /\x1b\[<(\d+);(\d+);(\d+)([mM])/.exec(input);
  if (!match) return null;
  return {
    x: Number(match[2]),
    y: Number(match[3]),
    action: match[4] === 'M' ? 'press' : 'release',
  };
}

export function drawConfirm(opts: { title: string; message: string }): Promise<boolean> {
  return new Promise(resolve => {
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
