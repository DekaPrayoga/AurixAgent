export interface DestructiveCommandMatch {
  command: string;
  tool: 'delete_file' | 'delete_folder';
  reason: string;
}

export interface RoutedDeleteCommand {
  tool: 'delete_file' | 'delete_folder';
  path: string;
}

export interface DependencyInstallCommandMatch {
  command: string;
  manager: string;
  reason: string;
}

export interface SensitiveToolActionMatch {
  command: string;
  reason: string;
}

const DELETE_COMMAND_PATTERNS: Array<{
  pattern: RegExp;
  tool: 'delete_file' | 'delete_folder';
  reason: string;
}> = [
  {
    pattern: /^\s*(sudo\s+)?(?:\/bin\/)?rm\s+-(?:[^\s]*r[^\s]*f?|[^\s]*f[^\s]*r)[\s=]/i,
    tool: 'delete_folder',
    reason: 'recursive rm',
  },
  {
    pattern: /^\s*(sudo\s+)?(?:\/bin\/)?rm\s+-[^\n;&|]*\br\b/i,
    tool: 'delete_folder',
    reason: 'recursive rm',
  },
  { pattern: /^\s*(sudo\s+)?(?:\/bin\/)?rm\s+/i, tool: 'delete_file', reason: 'rm file deletion' },
  { pattern: /^\s*(sudo\s+)?rmdir\s+/i, tool: 'delete_folder', reason: 'rmdir folder deletion' },
  { pattern: /^\s*(sudo\s+)?unlink\s+/i, tool: 'delete_file', reason: 'unlink file deletion' },
  { pattern: /^\s*del\s+/i, tool: 'delete_file', reason: 'del file deletion' },
  {
    pattern: /^\s*Remove-Item\s+.*(?:-Recurse|-r\b)/i,
    tool: 'delete_folder',
    reason: 'PowerShell recursive deletion',
  },
  { pattern: /^\s*Remove-Item\s+/i, tool: 'delete_file', reason: 'PowerShell file deletion' },
  { pattern: /\bfind\b[\s\S]*\s-delete\b/i, tool: 'delete_file', reason: 'find -delete' },
];

const DEPENDENCY_INSTALL_COMMAND_PATTERNS: Array<{
  pattern: RegExp;
  manager: string;
  reason: string;
}> = [
  {
    pattern: /^\s*(sudo\s+)?pip(?:3|x)?\s+install\b/i,
    manager: 'pip',
    reason: 'Python dependency install',
  },
  {
    pattern: /^\s*(sudo\s+)?python(?:3(?:\.\d+)?)?\s+-m\s+pip\s+install\b/i,
    manager: 'pip',
    reason: 'Python dependency install',
  },
  {
    pattern: /^\s*(sudo\s+)?uv\s+(?:pip\s+)?install\b/i,
    manager: 'uv',
    reason: 'Python dependency install',
  },
  {
    pattern: /^\s*(sudo\s+)?poetry\s+(?:add|install)\b/i,
    manager: 'poetry',
    reason: 'Python dependency install',
  },
  {
    pattern: /^\s*(sudo\s+)?pipenv\s+install\b/i,
    manager: 'pipenv',
    reason: 'Python dependency install',
  },
  {
    pattern: /^\s*(sudo\s+)?npm\s+(?:i|install|add)\b/i,
    manager: 'npm',
    reason: 'Node dependency install',
  },
  {
    pattern: /^\s*(?:corepack\s+)?(?:pnpm|yarn|bun)\s+(?:add|install|i)\b/i,
    manager: 'node',
    reason: 'Node dependency install',
  },
  {
    pattern: /^\s*(sudo\s+)?go\s+install\b/i,
    manager: 'go',
    reason: 'Go dependency/binary install',
  },
  {
    pattern: /^\s*(sudo\s+)?cargo\s+(?:install|add)\b/i,
    manager: 'cargo',
    reason: 'Rust dependency/binary install',
  },
  { pattern: /^\s*(sudo\s+)?gem\s+install\b/i, manager: 'gem', reason: 'Ruby dependency install' },
  {
    pattern: /^\s*(sudo\s+)?composer\s+(?:require|install)\b/i,
    manager: 'composer',
    reason: 'PHP dependency install',
  },
  {
    pattern: /^\s*(sudo\s+)?(?:apt|apt-get|dnf|yum|pacman|apk|brew)\s+(?:install|add)\b/i,
    manager: 'system',
    reason: 'System package install',
  },
];

function shellFragments(command: string): string[] {
  const fragments = command
    .split(/(?:&&|\|\||\||;|\n)/g)
    .map((part) => part.trim())
    .filter(Boolean);
  fragments.push(command);
  return fragments;
}

function broaden(pattern: RegExp): RegExp {
  const source = pattern.source.replace(/^\^\\s\*/, '').replace(/^\^/, '');
  return new RegExp(source, pattern.flags.includes('i') ? pattern.flags : pattern.flags + 'i');
}

export function detectBlockedDeleteCommand(command: string): DestructiveCommandMatch | null {
  for (const fragment of shellFragments(command)) {
    for (const item of DELETE_COMMAND_PATTERNS) {
      if (item.pattern.test(fragment) || broaden(item.pattern).test(fragment)) {
        return { command: fragment, tool: item.tool, reason: item.reason };
      }
    }
  }
  return null;
}

export function detectDependencyInstallCommand(
  command: string
): DependencyInstallCommandMatch | null {
  for (const fragment of shellFragments(command)) {
    for (const item of DEPENDENCY_INSTALL_COMMAND_PATTERNS) {
      if (item.pattern.test(fragment) || broaden(item.pattern).test(fragment)) {
        return { command: fragment, manager: item.manager, reason: item.reason };
      }
    }
  }
  return null;
}

export function parseRoutableDeleteCommand(command: string): RoutedDeleteCommand | null {
  if (!command.trim() || /(?:&&|\|\||[|;\n`$*?{}[\]<>])/.test(command)) return null;
  const match = command.trim().match(/^(?:\/bin\/)?rm\s+(-[rRfF]+\s+)?(?:--\s+)?("[^"]+"|'[^']+'|\S+)$/);
  if (!match) return null;
  const flags = match[1] || '';
  const rawPath = match[2];
  const target = rawPath.startsWith('"') || rawPath.startsWith("'") ? rawPath.slice(1, -1) : rawPath;
  if (!target || target === '/' || target === '.' || target === '..' || target.startsWith('-')) return null;
  return { tool: /[rR]/.test(flags) ? 'delete_folder' : 'delete_file', path: target };
}

export function formatBlockedDeleteCommand(match: DestructiveCommandMatch): string {
  return [
    `Blocked destructive command: ${match.command}`,
    `Reason: ${match.reason}`,
    '',
    `File/folder deletion must use the built-in ${match.tool} tool so Aurix can ask the user for deny/allow and keep a recovery window.`,
    match.tool === 'delete_folder'
      ? 'Use delete_folder with the target path instead of terminal rm/rmdir/Remove-Item.'
      : 'Use delete_file with the target path instead of terminal rm/del/unlink/Remove-Item.',
  ].join('\n');
}

export function requiresManualDeleteApproval(toolName: string): boolean {
  return toolName === 'delete_file' || toolName === 'delete_folder';
}

export function requiresManualSensitiveToolApproval(
  toolName: string,
  args: Record<string, unknown>
): SensitiveToolActionMatch | null {
  const action = typeof args.action === 'string' ? args.action : '';
  if (toolName === 'browser' && action === 'extract-cookies') {
    return { command: 'browser extract-cookies', reason: 'local browser credential export' };
  }
  if (
    toolName === 'docker_manage' &&
    ['build', 'run', 'stop', 'rm', 'compose-up', 'compose-down'].includes(action)
  ) {
    return { command: `docker_manage ${action}`, reason: 'Docker mutation' };
  }
  if (toolName === 'vps') {
    const target = typeof args.target === 'string' ? args.target : '';
    return {
      command: `vps ${action || '(unknown)'}${target ? ` ${target}` : ''}`,
      reason: 'VPS tool runs privileged shell commands',
    };
  }
  return null;
}

export function requiresManualDependencyInstallApproval(
  toolName: string,
  args: Record<string, unknown>
): DependencyInstallCommandMatch | null {
  if (toolName !== 'terminal') return null;
  const command = typeof args.command === 'string' ? args.command : '';
  if (!command) return null;
  return detectDependencyInstallCommand(command);
}
