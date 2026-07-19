import { createTerminalLifecycle } from './TerminalLifecycle.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function createMockProcess() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const writes: string[] = [];
  const rawCalls: boolean[] = [];
  const stdin = {
    isTTY: true,
    isRaw: false,
    resumeCalls: 0,
    pauseCalls: 0,
    setRawMode(mode: boolean) {
      rawCalls.push(mode);
      stdin.isRaw = mode;
      return stdin;
    },
    resume() {
      stdin.resumeCalls++;
      return stdin;
    },
    pause() {
      stdin.pauseCalls++;
      return stdin;
    },
  };
  return {
    rawCalls,
    writes,
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
    emit(event: string, value?: unknown) {
      listeners.get(event)?.forEach((listener) => listener(value));
    },
    process: {
      stdin,
      stdout: {
        isTTY: true,
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
        return this;
      },
      off(event: string, listener: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(listener);
        return this;
      },
    },
  };
}

{
  const mock = createMockProcess();
  const calls: string[] = [];
  const lifecycle = createTerminalLifecycle({
    process: mock.process,
    platform: 'linux',
    onCleanup: (reason) => {
      calls.push(reason);
    },
  });
  await lifecycle.start();
  await lifecycle.start();
  assert(lifecycle.started, 'lifecycle should be marked started');
  assert(mock.process.stdin.resumeCalls === 1, 'start should be idempotent');
  assert(mock.listenerCount('SIGINT') === 1, 'signal handler should install once');
  lifecycle.setRawMode(true);
  lifecycle.setRawMode(true);
  assert(mock.rawCalls.length === 1 && mock.rawCalls[0] === true, 'setRawMode should avoid redundant transitions');
  await lifecycle.dispose();
  await lifecycle.dispose();
  assert(lifecycle.disposed, 'lifecycle should be marked disposed');
  assert(mock.rawCalls.at(-1) === false, 'dispose should restore original raw mode');
  assert(mock.listenerCount('SIGINT') === 0, 'dispose should uninstall signal handlers');
  assert(mock.writes.length === 1 && mock.writes[0].includes('\x1b[0m'), 'dispose should emit terminal reset once');
  assert(calls.length === 0, 'dispose should not call signal cleanup');
}

{
  const mock = createMockProcess();
  const cleanup: string[] = [];
  const lifecycle = createTerminalLifecycle({
    process: mock.process,
    platform: 'linux',
    onCleanup: (reason) => {
      cleanup.push(reason);
    },
    exitOnSignal: false,
    exit: () => {
      throw new Error('unit test lifecycle must not force exit');
    },
  });
  await lifecycle.start();
  mock.emit('SIGINT', 'SIGINT');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(cleanup.includes('SIGINT'), 'signal handler should run cleanup');
  assert(lifecycle.disposed, 'signal handler should dispose lifecycle');
}

{
  const mock = createMockProcess();
  let flushed = 0;
  let guarded = 0;
  const lifecycle = createTerminalLifecycle({
    process: mock.process,
    platform: 'win32',
    windowsConsole: {
      platform: 'win32',
      stdin: mock.process.stdin,
      loadFfi: () => ({
        ptr: (buffer: Uint32Array) => buffer,
        symbols: {
          GetStdHandle: () => 'stdin-handle',
          GetConsoleMode: (_handle: unknown, buffer: Uint32Array) => {
            buffer[0] = 0x0001;
            return 1;
          },
          SetConsoleMode: () => 1,
          FlushConsoleInputBuffer: () => {
            flushed++;
            return 1;
          },
        },
      }),
      setInterval: () => ({ unref() {} }) as NodeJS.Timeout,
      clearInterval: () => {},
      setImmediate: (cb) => cb(),
    },
  });
  await lifecycle.start();
  guarded++;
  await lifecycle.dispose();
  assert(guarded === 1, 'windows lifecycle setup should complete');
  assert(flushed >= 2, 'windows lifecycle should flush input on start and dispose');
}

console.log('TerminalLifecycle tests passed');
