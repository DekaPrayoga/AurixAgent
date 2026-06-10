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
    process.stdout.write('\x1b[?2004h');

    function render() {
      const display = opts.masked ? '●'.repeat(buf.length) : buf;
      process.stdout.write(`\r  ${bg(bright(' ' + display + ' '))}   `);
    }
    render();

    function onData(ch: string) {
      const pasteMatch = ch.match(/\x1b\[200~([\s\S]*)\x1b\[201~/);
      if (pasteMatch) {
        buf += pasteMatch[1].replace(/\r\n/g, '\n').trimEnd();
        render();
        return;
      }

      if (ch.startsWith('\x1b[200~')) {
        buf += ch.slice(6).replace(/\r\n/g, '\n');
        render();
        return;
      }

      const c = ch.charCodeAt(0);

      if (c === 13 || c === 10) {
        stdin.removeListener('data', onData);
        process.stdout.write('\x1b[?2004l');
        if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
        process.stdout.write('\n');
        resolve(buf);
        return;
      }

      if (c === 27) {
        stdin.removeListener('data', onData);
        process.stdout.write('\x1b[?2004l');
        if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
        process.stdout.write('\n');
        resolve('__back__');
        return;
      }

      if (c === 127 || c === 8) {
        if (buf.length > 0) {
          buf = buf.slice(0, -1);
          render();
        }
        return;
      }

      if (c === 3) process.exit(0);

      if (c >= 32) {
        buf += ch;
        render();
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

    const cleanup = () => {
      stdin.removeListener('data', onData);
      disableMouse();
      if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
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
      const c = ch.charCodeAt(0);

      if (c === 27) {
        if (ch === '\x1b[A') { move(-1); return; }
        if (ch === '\x1b[B') { move(1); return; }
        if (ch === '\x1b[Z') { move(-1); return; }
        const mouse = parseMouse(ch);
        if (mouse && mouse.action === 'press') {
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
          return;
        }
        finish('__back__');
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
