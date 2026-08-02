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
  { match: ['web', 'fetch', 'research', 'search_web'], icon: '⌁', ascii: 'W' },
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
export type ToolVisualStatus = 'running' | 'success' | 'error' | 'timeout' | 'cancelled';

export function statusIcon(status: ToolVisualStatus | 'ok'): string {
  if (!CAPS.unicode) {
    if (status === 'success' || status === 'ok') return '[ok]';
    if (status === 'cancelled') return '[-]';
    if (status === 'running') return '...';
    return '[!]';
  }
  if (status === 'success' || status === 'ok') return '✓';
  if (status === 'cancelled') return '−';
  if (status === 'running') return '⋯';
  if (status === 'timeout') return '◷';
  return '✗';
}

export function statusColor(status: ToolVisualStatus): string {
  if (status === 'success') return theme.toolSuccess;
  if (status === 'running') return theme.toolRunning;
  if (status === 'cancelled') return theme.warn;
  return theme.toolError;
}

export function humanToolName(name?: string): string {
  const original = name || 'tool';
  const mcp = original.match(/^mcp_([^_]+)_(.+)$/i);
  if (mcp) return `MCP ${labelWords(mcp[1])} · ${labelWords(mcp[2])}`;
  const raw = original.replace(/^mcp__/, '').replace(/[_-]+/g, ' ').trim();
  return labelWords(raw);
}

function labelWords(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function compactValue(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, 90);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function toolSummary(name?: string, args?: Record<string, unknown>): string {
  if (!args) return '';
  const tool = (name || '').toLowerCase();
  const safe = Object.fromEntries(Object.entries(args).filter(([key]) =>
    !key.startsWith('_') && !/(token|password|secret|cookie|api.?key|authorization)/i.test(key)
  ));
  if (tool.includes('browser')) return [safe.action, safe.target || safe.value].map(compactValue).filter(Boolean).join(' ');
  if (tool.includes('terminal') || tool.includes('bash')) return compactValue(safe.command || safe.cmd);
  if (tool.includes('read')) return [safe.file_path || safe.path, safe.offset ? `:${safe.offset}` : ''].map(compactValue).join('');
  if (tool.includes('search') || tool.includes('grep')) return compactValue(safe.pattern || safe.query || safe.path);
  if (tool.includes('write') || tool.includes('edit')) return compactValue(safe.file_path || safe.path);
  if (tool.includes('web')) return compactValue(safe.url || safe.query);
  const first = Object.values(safe).map(compactValue).find(Boolean);
  return first || '';
}

export function formatDuration(durationMs?: number): string {
  if (typeof durationMs !== 'number') return '';
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

export const capabilities = CAPS;
