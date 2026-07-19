import { createWindowsConsoleModeController, type WindowsConsoleDeps } from './WindowsConsoleMode.js';

type StdinLike = {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  resume?: () => unknown;
  pause?: () => unknown;
};

type StdoutLike = {
  isTTY?: boolean;
  write?: (chunk: string) => unknown;
};

type ProcessLike = {
  stdin?: StdinLike;
  stdout?: StdoutLike;
  stderr?: StdoutLike;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  exit?: (code?: number) => never;
};

export type TerminalLifecycleDeps = {
  process?: ProcessLike;
  platform?: NodeJS.Platform;
  windowsConsole?: WindowsConsoleDeps;
  onCleanup?: (reason: string, error?: unknown) => void | Promise<void>;
  installSignalHandlers?: boolean;
  exitOnSignal?: boolean;
  exit?: (code: number) => never | void;
};

export type TerminalLifecycle = {
  start(): Promise<void>;
  dispose(): Promise<void>;
  installSignalHandlers(): void;
  uninstallSignalHandlers(): void;
  resetTerminal(): void;
  setRawMode(enabled: boolean): void;
  readonly started: boolean;
  readonly disposed: boolean;
};

const RESET_SEQUENCE = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[0m\x1b[?1049l';

export function createTerminalLifecycle(deps: TerminalLifecycleDeps = {}): TerminalLifecycle {
  const proc = deps.process ?? process;
  const stdin = proc.stdin;
  const stdout = proc.stdout;
  const win = createWindowsConsoleModeController({
    ...(deps.windowsConsole ?? {}),
    platform: deps.platform ?? deps.windowsConsole?.platform,
    stdin: deps.windowsConsole?.stdin ?? (stdin as WindowsConsoleDeps['stdin']),
  });

  let started = false;
  let disposed = false;
  let handlersInstalled = false;
  let originalRaw: boolean | undefined;
  let restoreWindows: (() => Promise<void>) | undefined;
  let disposing: Promise<void> | undefined;

  const cleanup = async (reason: string, error?: unknown) => {
    if (deps.onCleanup) await deps.onCleanup(reason, error);
  };

  const lifecycle = {
    get started() {
      return started;
    },
    get disposed() {
      return disposed;
    },
    async start() {
      if (started && !disposed) return;
      started = true;
      disposed = false;
      originalRaw = stdin?.isRaw;
      stdin?.resume?.();
      restoreWindows = await win.installRawModeGuard();
      await win.disableProcessedInput();
      await win.flushInputBuffer();
      if (deps.installSignalHandlers !== false) lifecycle.installSignalHandlers();
    },
    async dispose() {
      if (disposing) return disposing;
      disposing = (async () => {
        if (disposed) return;
        disposed = true;
        lifecycle.uninstallSignalHandlers();
        try {
          if (originalRaw !== undefined) lifecycle.setRawMode(originalRaw);
        } catch {
          // Best-effort terminal cleanup must not mask original failures.
        }
        await win.flushInputBuffer();
        if (restoreWindows) await restoreWindows();
        else await win.restore();
        lifecycle.resetTerminal();
      })();
      return disposing;
    },
    installSignalHandlers() {
      if (handlersInstalled || !proc.on) return;
      proc.on('SIGINT', onSignal);
      proc.on('SIGTERM', onSignal);
      proc.on('SIGHUP', onSignal);
      proc.on('uncaughtException', onError);
      proc.on('unhandledRejection', onError);
      handlersInstalled = true;
    },
    uninstallSignalHandlers() {
      if (!handlersInstalled) return;
      const off = proc.off ?? proc.removeListener;
      if (off) {
        off.call(proc, 'SIGINT', onSignal);
        off.call(proc, 'SIGTERM', onSignal);
        off.call(proc, 'SIGHUP', onSignal);
        off.call(proc, 'uncaughtException', onError);
        off.call(proc, 'unhandledRejection', onError);
      }
      handlersInstalled = false;
    },
    resetTerminal() {
      if (stdout?.isTTY && stdout.write) stdout.write(RESET_SEQUENCE);
    },
    setRawMode(enabled: boolean) {
      if (!stdin?.isTTY || typeof stdin.setRawMode !== 'function') return;
      if (stdin.isRaw === enabled) return;
      stdin.setRawMode(enabled);
    },
  } satisfies TerminalLifecycle;

  const onSignal = (signal: unknown) => {
    void (async () => {
      await cleanup(String(signal));
      await lifecycle.dispose();
      if (deps.exitOnSignal) (deps.exit ?? proc.exit)?.(signal === 'SIGINT' ? 130 : 1);
    })();
  };

  const onError = (error: unknown) => {
    void (async () => {
      await cleanup('error', error);
      await lifecycle.dispose();
      if (deps.exitOnSignal) (deps.exit ?? proc.exit)?.(1);
    })();
  };

  return lifecycle;
}
