import { theme } from './theme.js';
import { detectTerminalCapabilities } from './TerminalCapabilities.js';

const CAPS = detectTerminalCapabilities();

/**
 * A glyph per tool family, so a wall of tool calls is scannable by shape before it is read.
 * Matched on substrings because tool names vary by surface (`read_file`, `search_files`,
 * `browser`, `osint_investigate`, ...). Order matters: the first hit wins.
 */
const TOOL_ICONS: { match: string[]; icon: string; ascii: string }[] = [
  { match: ['read', 'glob', 'list'], icon: '←', ascii: '<' },
  { match: ['search', 'grep', 'find'], icon: '✱', ascii: '*' },
  { match: ['write', 'edit', 'create'], icon: '→', ascii: '>' },
  { match: ['delete', 'recovery', 'trash'], icon: '␥', ascii: 'x' },
  { match: ['terminal', 'bash', 'shell', 'code_exec'], icon: '$', ascii: '$' },
  { match: ['browser', 'captcha', 'signup', 'signin'], icon: '◈', ascii: '#' },
  { match: ['web', 'fetch', 'research', 'search_web'], icon: '%', ascii: '%' },
  { match: ['git', 'github'], icon: '⑂', ascii: 'Y' },
  { match: ['osint', 'cybersec', 'scan'], icon: '◉', ascii: 'o' },
  { match: ['ask', 'question'], icon: '?', ascii: '?' },
  { match: ['memory', 'brain', 'remember'], icon: '◇', ascii: '&' },
  { match: ['generate', 'image', 'pdf', 'excel', 'pptx'], icon: '▦', ascii: '+' },
  { match: ['spawn', 'agent', 'task'], icon: '⇴', ascii: '@' },
  { match: ['email', 'mail', 'telegram', 'discord'], icon: '✉', ascii: 'M' },
];

const DEFAULT_ICON = { icon: '▸', ascii: '>' };

export function toolIcon(name?: string): string {
  const tool = (name || '').toLowerCase();
  const hit = TOOL_ICONS.find((entry) => entry.match.some((m) => tool.includes(m)));
  const chosen = hit ?? DEFAULT_ICON;
  return CAPS.unicode ? chosen.icon : chosen.ascii;
}

/** Colour for a tool family. Kept beside the icons so the two never drift apart. */
export function toolColor(name?: string): string {
  const tool = (name || '').toLowerCase();
  if (tool.includes('read') || tool.includes('search') || tool.includes('grep')) return theme.info;
  if (tool.includes('write') || tool.includes('edit') || tool.includes('delete')) return theme.warn;
  if (tool.includes('terminal') || tool.includes('bash') || tool.includes('code_exec'))
    return theme.secondary;
  if (tool.includes('browser') || tool.includes('captcha')) return theme.accent;
  if (tool.includes('research') || tool.includes('web')) return theme.primary;
  if (tool.includes('git') || tool.includes('github')) return theme.ok;
  if (tool.includes('ask')) return theme.thinking;
  return theme.tool;
}

/** Status glyph for a finished/failed/running tool call. */
export function statusIcon(status: 'ok' | 'error' | 'running'): string {
  if (!CAPS.unicode) return status === 'ok' ? '[ok]' : status === 'error' ? '[!]' : '...';
  return status === 'ok' ? '✓' : status === 'error' ? '✗' : '⋯';
}

export const capabilities = CAPS;
