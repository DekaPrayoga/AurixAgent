import { ENABLE_PROCESSED_INPUT, createWindowsConsoleModeController } from './WindowsConsoleMode.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function createMockFfi(initialMode: number) {
  let mode = initialMode;
  let flushed = 0;
  const calls: Array<[string, number?]> = [];
  return {
    calls,
    get mode() {
      return mode;
    },
    get flushed() {
      return flushed;
    },
    ffi: {
      ptr: (buffer: Uint32Array) => buffer,
      symbols: {
        GetStdHandle: () => 'stdin-handle',
        GetConsoleMode: (_handle: unknown, buffer: Uint32Array) => {
          buffer[0] = mode;
          calls.push(['get', mode]);
          return 1;
        },
        SetConsoleMode: (_handle: unknown, nextMode: number) => {
          mode = nextMode;
          calls.push(['set', nextMode]);
          return 1;
        },
        FlushConsoleInputBuffer: () => {
          flushed++;
          calls.push(['flush']);
          return 1;
        },
      },
    },
  };
}

{
  let loaded = false;
  const controller = createWindowsConsoleModeController({
    platform: 'linux',
    stdin: { isTTY: true },
    loadFfi: () => {
      loaded = true;
      throw new Error('should not load off windows');
    },
  });
  assert(!controller.supported, 'off-Windows controller should not report supported');
  assert((await controller.disableProcessedInput()) === false, 'off-Windows disable should degrade to false');
  assert((await controller.flushInputBuffer()) === false, 'off-Windows flush should degrade to false');
  assert(!loaded, 'off-Windows path should not load FFI');
}

{
  const mock = createMockFfi(0x0080 | ENABLE_PROCESSED_INPUT);
  const controller = createWindowsConsoleModeController({
    platform: 'win32',
    stdin: { isTTY: true },
    loadFfi: () => mock.ffi,
  });
  assert((await controller.disableProcessedInput()) === true, 'disable should succeed with mock console');
  assert((mock.mode & ENABLE_PROCESSED_INPUT) === 0, 'processed input bit should be cleared');
  assert(controller.originalMode === (0x0080 | ENABLE_PROCESSED_INPUT), 'original mode should be preserved');
  assert((await controller.flushInputBuffer()) === true, 'flush should call console flush API');
  assert(mock.flushed === 1, 'flush should be called once');
  assert((await controller.restore()) === true, 'restore should succeed');
  assert(mock.mode === (0x0080 | ENABLE_PROCESSED_INPUT), 'restore should restore original mode');
}

{
  const mock = createMockFfi(0x0040 | ENABLE_PROCESSED_INPUT);
  const intervals: Array<() => void> = [];
  const cleared: unknown[] = [];
  const immediate: Array<() => void> = [];
  const rawCalls: boolean[] = [];
  const stdin = {
    isTTY: true,
    setRawMode(mode: boolean): unknown {
      rawCalls.push(mode);
      mock.ffi.symbols.SetConsoleMode('stdin-handle', 0x0040 | ENABLE_PROCESSED_INPUT);
      return this;
    },
  };
  const originalRaw = stdin.setRawMode;
  const controller = createWindowsConsoleModeController({
    platform: 'win32',
    stdin,
    loadFfi: () => mock.ffi,
    setImmediate: (cb) => immediate.push(cb),
    setInterval: (cb) => {
      intervals.push(cb);
      return { unref() {} } as NodeJS.Timeout;
    },
    clearInterval: (timer) => cleared.push(timer),
  });
  const restore = await controller.installRawModeGuard();
  assert(stdin.setRawMode !== originalRaw, 'guard should wrap setRawMode when available');
  stdin.setRawMode(true);
  assert(rawCalls.length === 1 && rawCalls[0] === true, 'wrapped raw mode should call original implementation');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert((mock.mode & ENABLE_PROCESSED_INPUT) === 0, 'guard should clear processed input after setRawMode');
  immediate.forEach((cb) => cb());
  intervals.forEach((cb) => cb());
  await restore();
  assert(stdin.setRawMode === originalRaw, 'restore should put original setRawMode back');
  assert(mock.mode === (0x0040 | ENABLE_PROCESSED_INPUT), 'restore should restore initial console mode');
  assert(cleared.length === 1, 'restore should clear guard interval');
}

console.log('WindowsConsoleMode tests passed');
