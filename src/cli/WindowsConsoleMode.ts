export const ENABLE_PROCESSED_INPUT = 0x0001;
const STD_INPUT_HANDLE = -10;

type ConsoleSymbols = {
  GetStdHandle(handle: number): unknown;
  GetConsoleMode(handle: unknown, modePtr: unknown): number;
  SetConsoleMode(handle: unknown, mode: number): number;
  FlushConsoleInputBuffer(handle: unknown): number;
};

type ConsoleFfi = {
  ptr(buffer: Uint32Array): unknown;
  symbols: ConsoleSymbols;
};

type StdinLike = {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

type BunFfiModule = {
  ptr(buffer: Uint32Array): unknown;
  dlopen(name: string, symbols: Record<string, unknown>): { symbols: ConsoleSymbols };
};

export type WindowsConsoleDeps = {
  platform?: NodeJS.Platform;
  stdin?: StdinLike;
  setImmediate?: (callback: () => void) => unknown;
  setInterval?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearInterval?: (timer: NodeJS.Timeout) => void;
  loadFfi?: () => Promise<ConsoleFfi | undefined> | ConsoleFfi | undefined;
};

export type WindowsConsoleModeController = {
  readonly supported: boolean;
  readonly originalMode?: number;
  disableProcessedInput(): Promise<boolean>;
  flushInputBuffer(): Promise<boolean>;
  installRawModeGuard(): Promise<() => Promise<void>>;
  restore(): Promise<boolean>;
};

let cachedFfi: ConsoleFfi | undefined;

async function defaultLoadFfi(): Promise<ConsoleFfi | undefined> {
  if (process.platform !== 'win32') return undefined;
  try {
    const specifier = 'bun:ffi';
    const ffi = (await import(specifier)) as BunFfiModule;
    const lib = ffi.dlopen('kernel32.dll', {
      GetStdHandle: { args: ['i32'], returns: 'ptr' },
      GetConsoleMode: { args: ['ptr', 'ptr'], returns: 'i32' },
      SetConsoleMode: { args: ['ptr', 'u32'], returns: 'i32' },
      FlushConsoleInputBuffer: { args: ['ptr'], returns: 'i32' },
    });
    cachedFfi = { ptr: ffi.ptr, symbols: lib.symbols as ConsoleSymbols };
    return cachedFfi;
  } catch {
    return undefined;
  }
}

export function createWindowsConsoleModeController(
  deps: WindowsConsoleDeps = {}
): WindowsConsoleModeController {
  const platform = deps.platform ?? process.platform;
  const stdin = deps.stdin ?? process.stdin;
  const setImmediateFn = deps.setImmediate ?? setImmediate;
  const setIntervalFn = deps.setInterval ?? setInterval;
  const clearIntervalFn = deps.clearInterval ?? clearInterval;
  const loadFfi = deps.loadFfi ?? (() => cachedFfi ?? defaultLoadFfi());

  let ffi: ConsoleFfi | undefined;
  let handle: unknown;
  let originalMode: number | undefined;
  let rawModeOriginal: ((mode: boolean) => unknown) | undefined;
  let rawModeWrapped: ((mode: boolean) => unknown) | undefined;
  let interval: NodeJS.Timeout | undefined;
  let disposed = false;

  const ensure = async (): Promise<boolean> => {
    if (platform !== 'win32' || !stdin?.isTTY) return false;
    ffi ??= await loadFfi();
    if (!ffi) return false;
    handle ??= ffi.symbols.GetStdHandle(STD_INPUT_HANDLE);
    if (originalMode === undefined) {
      const buf = new Uint32Array(1);
      if (ffi.symbols.GetConsoleMode(handle, ffi.ptr(buf)) === 0) return false;
      originalMode = buf[0];
    }
    return true;
  };

  const readMode = async (): Promise<number | undefined> => {
    if (!(await ensure()) || !ffi) return undefined;
    const buf = new Uint32Array(1);
    if (ffi.symbols.GetConsoleMode(handle, ffi.ptr(buf)) === 0) return undefined;
    return buf[0];
  };

  const disableProcessedInput = async (): Promise<boolean> => {
    const mode = await readMode();
    if (mode === undefined || !ffi) return false;
    if ((mode & ENABLE_PROCESSED_INPUT) === 0) return true;
    return ffi.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT) !== 0;
  };

  const enforceSoon = () => {
    void disableProcessedInput();
    setImmediateFn(() => void disableProcessedInput());
  };

  const restore = async (): Promise<boolean> => {
    if (disposed) return true;
    disposed = true;
    if (interval) clearIntervalFn(interval);
    interval = undefined;
    if (rawModeWrapped && stdin.setRawMode === rawModeWrapped) {
      stdin.setRawMode = rawModeOriginal as ((mode: boolean) => unknown) | undefined;
    }
    rawModeWrapped = undefined;
    if (!(await ensure()) || !ffi || originalMode === undefined) return false;
    return ffi.symbols.SetConsoleMode(handle, originalMode) !== 0;
  };

  return {
    get supported() {
      return platform === 'win32' && !!stdin?.isTTY;
    },
    get originalMode() {
      return originalMode;
    },
    disableProcessedInput,
    async flushInputBuffer(): Promise<boolean> {
      if (!(await ensure()) || !ffi) return false;
      return ffi.symbols.FlushConsoleInputBuffer(handle) !== 0;
    },
    async installRawModeGuard(): Promise<() => Promise<void>> {
      if (!(await ensure())) return async () => {};
      if (typeof stdin.setRawMode === 'function' && !rawModeWrapped) {
        rawModeOriginal = stdin.setRawMode;
        rawModeWrapped = (mode: boolean) => {
          const result = rawModeOriginal?.call(stdin, mode);
          enforceSoon();
          return result;
        };
        stdin.setRawMode = rawModeWrapped;
      }
      await disableProcessedInput();
      interval ??= setIntervalFn(() => void disableProcessedInput(), 100);
      interval.unref?.();
      return async () => {
        await restore();
      };
    },
    restore,
  };
}

export async function disableWindowsProcessedInput(
  deps?: WindowsConsoleDeps
): Promise<boolean> {
  return createWindowsConsoleModeController(deps).disableProcessedInput();
}

export async function flushWindowsConsoleInputBuffer(
  deps?: WindowsConsoleDeps
): Promise<boolean> {
  return createWindowsConsoleModeController(deps).flushInputBuffer();
}
