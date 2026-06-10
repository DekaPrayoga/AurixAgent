let patched = false;
let disableInterval: ReturnType<typeof setInterval> | null = null;

const MOUSE_ENABLE_RE = /\x1b\[\?(?:1000|1002|1003|1006|1015)h/g;
const DISABLE_SEQ = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l';

export function installMouseFilter(): void {
  if (patched || !process.stdout.isTTY) return;
  patched = true;

  const origWrite = process.stdout.write.bind(process.stdout);

  (process.stdout as any).write = function (
    chunk: string | Uint8Array,
    ...rest: any[]
  ): boolean {
    if (typeof chunk === 'string') {
      if (MOUSE_ENABLE_RE.test(chunk)) {
        const filtered = chunk.replace(MOUSE_ENABLE_RE, '');
        if (filtered.length === 0) return true;
        return origWrite(filtered, ...rest);
      }
    } else if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
      const str = Buffer.from(chunk).toString('utf8');
      if (MOUSE_ENABLE_RE.test(str)) {
        const filtered = str.replace(MOUSE_ENABLE_RE, '');
        if (filtered.length === 0) return true;
        return origWrite(filtered, ...rest);
      }
    }
    return origWrite(chunk, ...rest);
  };

  origWrite(DISABLE_SEQ);

  disableInterval = setInterval(() => {
    if (process.stdout.isTTY) {
      origWrite(DISABLE_SEQ);
    }
  }, 1000);

  const cleanup = () => {
    if (disableInterval) {
      clearInterval(disableInterval);
      disableInterval = null;
    }
    origWrite(DISABLE_SEQ);
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
}
