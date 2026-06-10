const MOUSE_ENABLE_RE = /\x1b\[\?(?:1000|1002|1003|1006|1015)h/g;

let patched = false;

export function installMouseFilter(): void {
  if (patched || !process.stdout.isTTY) return;
  patched = true;

  const origWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error) => void),
    cb?: (err?: Error) => void,
  ): boolean => {
    if (typeof chunk === 'string') {
      const filtered = chunk.replace(MOUSE_ENABLE_RE, '');
      return origWrite(filtered, encodingOrCb as any, cb as any);
    }
    if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
      const str = Buffer.from(chunk).toString('utf8');
      const filtered = str.replace(MOUSE_ENABLE_RE, '');
      return origWrite(filtered, encodingOrCb as any, cb as any);
    }
    return origWrite(chunk, encodingOrCb as any, cb as any);
  };

  origWrite('\x1b[?1000l');
  origWrite('\x1b[?1002l');
  origWrite('\x1b[?1003l');
  origWrite('\x1b[?1006l');
  origWrite('\x1b[?1015l');

  process.on('exit', () => {
    origWrite('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l');
  });
}
