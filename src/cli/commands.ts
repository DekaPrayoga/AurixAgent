import type { ToolRegistry } from '../tools/Registry.js';

export type CommandSource = 'aurix' | 'claude-code' | 'opencode' | 'hermes' | 'skill' | 'plugin';

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  argumentHint?: string;
  group: string;
  source: CommandSource;
  sensitive?: boolean;
}

export interface CommandContext {
  toolCount: number;
  skillCount: number;
  registry: ToolRegistry;
}

const baseCommands: SlashCommand[] = [
  {
    name: 'help',
    aliases: ['commands'],
    description: 'Show commands, keybindings, and current capabilities',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'clear',
    aliases: ['new'],
    description: 'Clear the transcript and reset the visible screen',
    group: 'session',
    source: 'opencode',
  },
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit AURIX',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'status',
    description: 'Show model, provider, mode, permissions, tools, and uptime',
    group: 'session',
    source: 'opencode',
  },
  {
    name: 'history',
    description: 'Show message count for the current context',
    group: 'session',
    source: 'aurix',
  },
  {
    name: 'context',
    description: 'Show context usage and compaction stats',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'compact',
    description: 'Compact long context on the next model turn',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'reset',
    description: 'Reset the agent loop and start a fresh context',
    group: 'session',
    source: 'aurix',
  },
  {
    name: 'model',
    argumentHint: '<model-id>',
    description: 'Switch model for this session',
    group: 'model',
    source: 'claude-code',
  },
  {
    name: 'depth',
    argumentHint: '<low|medium|high|xhigh|max|ultra>',
    description: 'Set research depth and multi-agent intensity',
    group: 'model',
    source: 'aurix',
  },
  {
    name: 'multiagent',
    aliases: ['agents'],
    description: 'Toggle LangGraph multi-agent routing',
    group: 'agent',
    source: 'aurix',
  },
  {
    name: 'tools',
    description: 'List loaded tools',
    group: 'tools',
    source: 'claude-code',
  },
  {
    name: 'permissions',
    aliases: ['allowed-tools'],
    description: 'Inspect or clear tool permission rules',
    argumentHint: '[clear|mode ask|mode bypass|mode deny]',
    group: 'tools',
    source: 'claude-code',
  },
  {
    name: 'skills',
    description: 'List loaded AURIX skills and skill categories',
    argumentHint: '[search]',
    group: 'skills',
    source: 'claude-code',
  },
  {
    name: 'addskills',
    description: 'Enable Multiversal skill_loader tool (280+ skills)',
    group: 'skills',
    source: 'aurix',
  },
  {
    name: 'disable',
    argumentHint: '[tool-name]',
    description: 'Disable a tool to save tokens (e.g. /disable skill_loader)',
    group: 'tools',
    source: 'aurix',
  },
  {
    name: 'skill',
    description: 'Create a local skill scaffold',
    argumentHint: 'new <name>',
    group: 'skills',
    source: 'claude-code',
  },
  {
    name: 'plugin',
    description: 'Manage local/plugin-store extensions',
    argumentHint: '[list|install <path-or-git-url>|create <name>]',
    group: 'plugins',
    source: 'claude-code',
  },
  {
    name: 'github',
    aliases: ['gh'],
    description: 'Show GitHub connection status and setup hints',
    group: 'connect',
    source: 'claude-code',
  },
  {
    name: 'gmail',
    aliases: ['email'],
    description: 'Show Gmail/email connection status and setup hints',
    group: 'connect',
    source: 'aurix',
  },
  {
    name: 'discord',
    description: 'Connect Discord bot with token input',
    group: 'connect',
    source: 'aurix',
  },
  {
    name: 'telegram',
    description: 'Connect Telegram bot with token input',
    group: 'connect',
    source: 'aurix',
  },
  {
    name: 'whatsapp',
    description: 'Connect WhatsApp via QR code scan',
    group: 'connect',
    source: 'aurix',
  },
  {
    name: 'setup',
    description: 'Re-run interactive setup wizard',
    group: 'config',
    source: 'aurix',
  },
  {
    name: 'config',
    description: 'Show config path and editable settings summary',
    group: 'config',
    source: 'claude-code',
  },
  {
    name: 'theme',
    aliases: ['color'],
    description: 'Show current theme and setup command for changing it',
    group: 'config',
    source: 'claude-code',
  },
  {
    name: 'review',
    description: 'Ask AURIX to review the current repository',
    group: 'workflows',
    source: 'claude-code',
  },
  {
    name: 'plan',
    description: 'Ask AURIX to produce an implementation plan first',
    group: 'workflows',
    source: 'claude-code',
  },
  {
    name: 'diff',
    description: 'Ask AURIX to inspect current git diff',
    group: 'workflows',
    source: 'claude-code',
  },
  {
    name: 'mcp',
    description: 'Show MCP/plugin bridge setup status',
    group: 'connect',
    source: 'claude-code',
  },
  {
    name: 'login',
    aliases: ['baseurl', 'url', 'provider', 'apikey', 'key'],
    description: 'Open login dialog to set API key, base URL, and model',
    group: 'model',
    source: 'opencode',
  },
  {
    name: 'cost',
    description: 'Show session token usage and estimated cost',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'doctor',
    description: 'Run health checks on Node, provider, tools, and memory',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'effort',
    argumentHint: '<low|medium|high|xhigh|max|ultra>',
    description: 'Alias for /depth — set reasoning effort',
    group: 'model',
    source: 'claude-code',
  },
  {
    name: 'fast',
    description: 'Quickly switch to low effort (fast mode)',
    group: 'model',
    source: 'claude-code',
  },
  {
    name: 'export',
    description: 'Export the current session to markdown',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'memory',
    description: 'Show memory system status and storage path',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'deep',
    description: 'Toggle deep research mode (max depth + multi-agent)',
    group: 'model',
    source: 'aurix',
  },
  {
    name: 'deep-research',
    argumentHint: '<topic>',
    description: 'Run comprehensive multi-agent research pipeline on a topic',
    group: 'model',
    source: 'aurix',
  },
  {
    name: 'init',
    description: 'Generate AURIX.md project context file',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'copy',
    argumentHint: '[N]',
    description: 'Copy last N assistant messages to clipboard',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'rewind',
    description: 'Revert to last checkpoint',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'recap',
    description: 'Summarize conversation progress',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'code-review',
    argumentHint: '[level]',
    description: 'Review current git diff for issues',
    group: 'workflows',
    source: 'claude-code',
  },
  {
    name: 'security-review',
    description: 'Scan codebase for security vulnerabilities',
    group: 'workflows',
    source: 'claude-code',
  },
  {
    name: 'simplify',
    argumentHint: '[target]',
    description: 'Suggest code simplifications and refactoring',
    group: 'workflows',
    source: 'claude-code',
  },
  {
    name: 'research-forums',
    aliases: ['last30days', 'forums', 'social-search'],
    argumentHint: '<topic>',
    description: 'Research any topic across Reddit, X, YouTube, HN, Polymarket + 10 more sources',
    group: 'workflows',
    source: 'skill',
  },
  {
    name: 'verify',
    description: 'Run type checks, tests, and build validation',
    group: 'workflows',
    source: 'claude-code',
  },
  {
    name: 'goal',
    argumentHint: '<condition>',
    description: 'Auto-continue until condition is met',
    group: 'agent',
    source: 'claude-code',
  },
  {
    name: 'fork',
    argumentHint: '<directive>',
    description: 'Spawn background sub-agent for task',
    group: 'agent',
    source: 'claude-code',
  },
  {
    name: 'branch',
    argumentHint: '[name]',
    description: 'Create divergent conversation branch',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'btw',
    argumentHint: '<question>',
    description: 'Quick side question without context',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'insights',
    description: 'Analyze coding patterns and architecture',
    group: 'workflows',
    source: 'claude-code',
  },
  {
    name: 'debug',
    argumentHint: '[description]',
    description: 'Enable session debug logging',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'add-dir',
    argumentHint: '<path>',
    description: 'Grant file access to directory',
    group: 'config',
    source: 'claude-code',
  },
  {
    name: 'focus',
    description: 'Toggle minimalist UI mode',
    group: 'config',
    source: 'claude-code',
  },
  {
    name: 'resume',
    argumentHint: '[session]',
    description: 'Reopen archived conversation',
    group: 'session',
    source: 'claude-code',
  },
  {
    name: 'retry',
    description: 'Resend last user message',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'undo',
    description: 'Delete last user+assistant interaction',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'save',
    description: 'Save session transcript to file',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'title',
    argumentHint: '<name>',
    description: 'Rename current session',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'rollback',
    argumentHint: '[N]',
    description: 'Rollback N interactions',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'snapshot',
    argumentHint: '[name]',
    description: 'Save or restore config snapshot',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'steer',
    argumentHint: '<guidance>',
    description: 'Inject guidance after next tool call',
    group: 'agent',
    source: 'hermes',
  },
  {
    name: 'queue',
    argumentHint: '<text>',
    description: 'Schedule next input after current task',
    group: 'agent',
    source: 'hermes',
  },
  {
    name: 'verbose',
    description: 'Toggle verbose tool output',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'reasoning',
    argumentHint: '<low|medium|high>',
    description: 'Adjust reasoning depth level',
    group: 'model',
    source: 'hermes',
  },
  {
    name: 'yolo',
    description: 'Auto-approve all tool calls (bypass mode)',
    group: 'tools',
    source: 'hermes',
  },
  {
    name: 'image',
    argumentHint: '<path>',
    description: 'Attach image file to conversation',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'sessions',
    description: 'List past saved sessions',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'new',
    aliases: ['reset'],
    description: 'Start a new session (fresh context + history)',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'stop',
    description: 'Kill all running background processes',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'approve',
    argumentHint: '[session|always]',
    description: 'Approve a pending dangerous command',
    group: 'tools',
    source: 'hermes',
  },
  {
    name: 'deny',
    description: 'Deny a pending dangerous command',
    group: 'tools',
    source: 'hermes',
  },
  {
    name: 'background',
    aliases: ['bg'],
    argumentHint: '<prompt>',
    description: 'Run a prompt in the background',
    group: 'agent',
    source: 'hermes',
  },
  {
    name: 'agents',
    aliases: ['tasks'],
    description: 'Show active agents and running tasks',
    group: 'agent',
    source: 'hermes',
  },
  {
    name: 'subgoal',
    argumentHint: '[text | remove N | clear]',
    description: 'Add or manage extra criteria on active goal',
    group: 'agent',
    source: 'hermes',
  },
  {
    name: 'whoami',
    description: 'Show your slash command access level',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'profile',
    description: 'Show active profile name and home directory',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'personality',
    argumentHint: '[name]',
    description: 'Set a predefined personality overlay',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'statusbar',
    aliases: ['sb'],
    description: 'Toggle the context/model status bar',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'footer',
    argumentHint: '[on|off|status]',
    description: 'Toggle gateway runtime-metadata footer',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'skin',
    argumentHint: '[name]',
    description: 'Show or change the display skin/theme',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'indicator',
    argumentHint: '[kaomoji|emoji|unicode|ascii]',
    description: 'Pick the TUI busy-indicator style',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'voice',
    argumentHint: '[on|off|tts|status]',
    description: 'Toggle voice mode',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'busy',
    argumentHint: '[queue|steer|interrupt|status]',
    description: 'Control what Enter does while agent is working',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'toolsets',
    description: 'List available toolsets',
    group: 'tools',
    source: 'hermes',
  },
  {
    name: 'bundles',
    description: 'List skill bundles (aliases for multiple skills)',
    group: 'skills',
    source: 'hermes',
  },
  {
    name: 'cron',
    argumentHint: '[list|add|create|edit|pause|resume|run|remove]',
    description: 'Manage scheduled tasks',
    group: 'tools',
    source: 'hermes',
  },
  {
    name: 'curator',
    argumentHint: '[status|run|pause|resume|pin|unpin|restore]',
    description: 'Background skill maintenance',
    group: 'skills',
    source: 'hermes',
  },
  {
    name: 'kanban',
    argumentHint: '[init|boards|create|list|show|assign]',
    description: 'Multi-profile collaboration board',
    group: 'workflows',
    source: 'hermes',
  },
  {
    name: 'reload',
    description: 'Reload .env variables into running session',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'reload-mcp',
    description: 'Reload MCP servers from config',
    group: 'connect',
    source: 'hermes',
  },
  {
    name: 'reload-skills',
    description: 'Re-scan skills directory for changes',
    group: 'skills',
    source: 'hermes',
  },
  {
    name: 'browser',
    argumentHint: '[connect|disconnect|status]',
    description: 'Connect browser tools to live Chromium via CDP',
    group: 'tools',
    source: 'hermes',
  },
  {
    name: 'plugins',
    description: 'List installed plugins and their status',
    group: 'plugins',
    source: 'hermes',
  },
  {
    name: 'restart',
    description: 'Gracefully restart the agent after draining',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'usage',
    description: 'Show token usage and rate limits for session',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'platforms',
    aliases: ['gateway'],
    description: 'Show gateway/messaging platform status',
    group: 'connect',
    source: 'hermes',
  },
  {
    name: 'platform',
    argumentHint: '<pause|resume|list> [name]',
    description: 'Pause, resume, or list a gateway platform',
    group: 'connect',
    source: 'hermes',
  },
  {
    name: 'paste',
    description: 'Attach clipboard image to conversation',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'update',
    description: 'Update AURIX Agent to the latest version',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'redraw',
    description: 'Force a full UI repaint',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'compress',
    argumentHint: '[focus topic]',
    description: 'Manually compress conversation context',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'handoff',
    argumentHint: '<platform>',
    description: 'Hand off session to a messaging platform',
    group: 'session',
    source: 'hermes',
  },
  {
    name: 'codex-runtime',
    argumentHint: '[auto|codex_app_server]',
    description: 'Toggle codex runtime for OpenAI models',
    group: 'config',
    source: 'hermes',
  },
  {
    name: 'editor',
    description: 'Open external editor for composing message',
    group: 'session',
    source: 'opencode',
  },
  {
    name: 'warp',
    argumentHint: '<workspace>',
    description: 'Set active workspace',
    group: 'config',
    source: 'opencode',
  },
  {
    name: 'move',
    description: 'Move session to different workspace',
    group: 'session',
    source: 'opencode',
  },
  {
    name: 'stash',
    description: 'Stash current input for later',
    group: 'session',
    source: 'opencode',
  },
  {
    name: 'tag',
    description: 'Tag the current session',
    group: 'session',
    source: 'opencode',
  },
  {
    name: 'variant',
    description: 'Select model variant',
    group: 'model',
    source: 'opencode',
  },
];

export function createSlashCommands(ctx: CommandContext): SlashCommand[] {
  const toolCommands = ctx.registry.list().slice(0, 16).map((tool): SlashCommand => ({
    name: `tool:${tool.name}`,
    description: tool.description,
    group: 'tools',
    source: 'aurix',
  }));

  return [...baseCommands, ...toolCommands].sort((a, b) => a.name.localeCompare(b.name));
}

export function parseSlash(input: string): { name: string; args: string } | null {
  if (!input.startsWith('/')) return null;
  const raw = input.slice(1).trim();
  const [name = '', ...rest] = raw.split(/\s+/);
  return { name: name.toLowerCase(), args: rest.join(' ') };
}

export function findCommand(commands: SlashCommand[], name: string): SlashCommand | undefined {
  return commands.find(command =>
    command.name === name ||
    command.aliases?.some(alias => alias === name)
  );
}

export function filterSlashCommands(commands: SlashCommand[], query: string, limit = 30): SlashCommand[] {
  const q = query.replace(/^\//, '').toLowerCase().trim();
  if (!q) return commands.slice(0, limit);

  const scored = commands
    .map(command => {
      const names = [command.name, ...(command.aliases || [])];
      const starts = names.some(name => name.startsWith(q));
      const includes = names.some(name => name.includes(q)) || command.description.toLowerCase().includes(q);
      const score = starts ? 0 : includes ? 1 : 2;
      return { command, score };
    })
    .filter(item => item.score < 2)
    .sort((a, b) => a.score - b.score || a.command.name.localeCompare(b.command.name));

  return scored.slice(0, limit).map(item => item.command);
}

export function completeCommand(command: SlashCommand): string {
  return `/${command.name}${command.argumentHint ? ' ' : ' '}`;
}

export function formatCommandHelp(commands: SlashCommand[]): string {
  const groups = new Map<string, SlashCommand[]>();
  for (const command of commands.filter(c => !c.name.startsWith('tool:'))) {
    const list = groups.get(command.group) || [];
    list.push(command);
    groups.set(command.group, list);
  }

  return Array.from(groups.entries())
    .map(([group, items]) => {
      const lines = items
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(command => {
          const alias = command.aliases?.length ? ` (${command.aliases.join(', ')})` : '';
          const args = command.argumentHint ? ` ${command.argumentHint}` : '';
          return `  /${(command.name + args).padEnd(28)} ${command.description}${alias}`;
        });
      return `${group.toUpperCase()}\n${lines.join('\n')}`;
    })
    .join('\n\n');
}
