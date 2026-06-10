export function disableMouseReporting(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[?1000l');
  process.stdout.write('\x1b[?1002l');
  process.stdout.write('\x1b[?1003l');
  process.stdout.write('\x1b[?1006l');
  process.stdout.write('\x1b[?1015l');
}

export function enableMouseReporting(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[?1000h');
  process.stdout.write('\x1b[?1002h');
}

export function filterMouseSequences(data: Buffer | string): string {
  const str = typeof data === 'string' ? data : data.toString('utf8');
  return str
    .replace(/\x1b\[M[ -~]{0,3}/g, '')
    .replace(/\x1b\[<[\d;]+[mM]/g, '')
    .replace(/\x1b\[[\d;]+[mM]/g, '')
    .replace(/\x1b\[>[\d;]+[mM]/g, '')
    .replace(/\x1b\[\\[\d;]+[mM]/g, '')
    .replace(/\[<[\d;]+[mM]/g, '')
    .replace(/\[<[\d;]+[mM][\s\S]{0,20}?\]/g, '');
}

export function installMouseFilter(): void {
  disableMouseReporting();

  if (process.stdin.isTTY) {
    const origOn = process.stdin.on.bind(process.stdin);
    process.stdin.on = ((event: string, listener: (...args: any[]) => void) => {
      if (event === 'data') {
        const wrappedListener = (chunk: Buffer | string) => {
          const filtered = filterMouseSequences(chunk);
          if (filtered.length > 0) {
            listener(filtered);
          }
        };
        return origOn(event, wrappedListener);
      }
      return origOn(event, listener);
    }) as any;
  }

  const cleanup = () => {
    enableMouseReporting();
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
}
