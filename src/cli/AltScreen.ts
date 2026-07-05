let entered = false;
let originalBg: string | null = null;

function isSafeHexColor(value: string | null): value is string {
  return !!value && /^#[0-9a-fA-F]{6}$/.test(value);
}

function write(s: string): void {
  process.stdout.write(s);
}

export function enterAltScreen(): void {
  if (entered) return;
  if (!process.stdout.isTTY) return;
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  if (process.stdin.isTTY) {
    const bgListener = (chunk: Buffer) => {
      const match = /\x1b\]11;rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})/i.exec(chunk.toString());
      if (match) {
        originalBg = `#${match[1].slice(0, 2)}${match[2].slice(0, 2)}${match[3].slice(0, 2)}`;
      }
    };
    process.stdin.on('data', bgListener);
    write('\x1b]11;?\x1b\\');
    write('\x1b]11;?\x07');
    setTimeout(() => {
      if (process.stdin.isTTY) process.stdin.off('data', bgListener);
    }, 50);
  }

  write('\x1b[?1049h');
  write('\x1b[2J');
  write('\x1b[H');

  write('\x1b]11;#000000\x1b\\');
  write('\x1b]11;#000000\x07');
  write('\x1b]4;0;#000000\x07');

  for (let i = 0; i < rows; i++) {
    write(`\x1b[${i + 1};1H\x1b[40m${' '.repeat(cols)}`);
  }
  write(`\x1b[1;1H\x1b[40m`);

  entered = true;

  const restore = () => {
    if (!entered) return;
    if (isSafeHexColor(originalBg)) {
      write(`\x1b]11;${originalBg}\x1b\\`);
      write(`\x1b]11;${originalBg}\x07`);
    }
    write('\x1b[0m');
    write('\x1b[?1049l');
    entered = false;
  };

  process.on('exit', restore);
  process.on('uncaughtException', (err) => {
    restore();
    console.error(err);
    process.exit(1);
  });
  process.on('SIGINT', () => { restore(); process.exit(130); });
  process.on('SIGTERM', () => { restore(); process.exit(143); });
}

export function leaveAltScreen(): void {
  if (!entered) return;
  if (!process.stdout.isTTY) return;
  if (isSafeHexColor(originalBg)) {
    write(`\x1b]11;${originalBg}\x1b\\`);
    write(`\x1b]11;${originalBg}\x07`);
  }
  write('\x1b[0m');
  write('\x1b[?1049l');
  entered = false;
}
