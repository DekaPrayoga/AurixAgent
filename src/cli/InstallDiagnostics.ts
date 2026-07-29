import fs from 'node:fs';
import path from 'node:path';

export type InstallMethod = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'source' | 'unknown';

export interface InstallDiagnosis {
  method: InstallMethod;
  root: string;
  updateCommand: string;
  detail: string;
}

function userAgentMethod(userAgent = ''): InstallMethod | undefined {
  const value = userAgent.toLowerCase();
  if (value.startsWith('pnpm/')) return 'pnpm';
  if (value.startsWith('yarn/')) return 'yarn';
  if (value.startsWith('bun/')) return 'bun';
  if (value.startsWith('npm/')) return 'npm';
  return undefined;
}

export function detectInstallMethod(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = fs.existsSync
): InstallDiagnosis {
  const resolved = path.resolve(root);
  if (exists(path.join(resolved, '.git'))) {
    return {
      method: 'source',
      root: resolved,
      updateCommand: 'git pull && bun install && bun run build',
      detail: 'source checkout',
    };
  }

  const fromAgent = userAgentMethod(env.npm_config_user_agent);
  const packagePath = resolved.replace(/\\/g, '/');
  const inferred: InstallMethod = fromAgent ||
    (packagePath.includes('/pnpm/') ? 'pnpm' :
      packagePath.includes('/yarn/') ? 'yarn' :
        packagePath.includes('/bun/') ? 'bun' :
          packagePath.includes('/node_modules/') ? 'npm' : 'unknown');

  const commands: Record<InstallMethod, string> = {
    npm: 'npm install -g aurix-ai@latest',
    pnpm: 'pnpm add -g aurix-ai@latest',
    yarn: 'yarn global add aurix-ai@latest',
    bun: 'bun add -g aurix-ai@latest',
    source: 'git pull && bun install && bun run build',
    unknown: 'npm install -g aurix-ai@latest',
  };
  return {
    method: inferred,
    root: resolved,
    updateCommand: commands[inferred],
    detail: inferred === 'unknown' ? 'installation method could not be detected' : `${inferred} global package`,
  };
}

export function terminalDiagnostics(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  arch = process.arch
): string[] {
  const terminal = env.WT_SESSION
    ? 'Windows Terminal'
    : env.TERM_PROGRAM || env.TERM || (process.stdout.isTTY ? 'TTY' : 'non-TTY');
  const shell = platform === 'win32' ? env.COMSPEC || 'cmd.exe' : env.SHELL || '(unknown)';
  const platformDetails = platform === 'win32'
    ? `Console: Windows guard enabled when FFI is available; shell=${shell}; clipboard=PowerShell/OSC52`
    : platform === 'darwin'
      ? `Desktop: macOS; shell=${shell}; clipboard=pbcopy/OSC52`
      : `Desktop: Linux; shell=${shell}; display=${env.WAYLAND_DISPLAY ? 'Wayland' : env.DISPLAY ? `X11 ${env.DISPLAY}` : 'headless'}; clipboard=Wayland/X11/OSC52`;
  return [
    `Platform: ${platform} ${arch}`,
    `Runtime: Node ${process.version}${process.versions.bun ? `; Bun ${process.versions.bun}` : ''}`,
    `Terminal: ${terminal}`,
    `TTY: stdin=${Boolean(process.stdin.isTTY)} stdout=${Boolean(process.stdout.isTTY)}`,
    `Color: ${env.NO_COLOR !== undefined ? 'disabled (NO_COLOR)' : 'enabled'}`,
    platformDetails,
    `Command guidance: ${platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS/POSIX' : 'Linux/POSIX'}`,
  ];
}
