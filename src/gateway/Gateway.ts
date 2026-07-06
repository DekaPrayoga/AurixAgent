import { AskUserManager, setGlobalAskCallback } from '../tools/AskUser.js';
import { EventEmitter } from 'events';
import fs from 'fs';
import crypto from 'crypto';
import type { AurixConfig } from '../agent/Config.js';
import { loadConfig, saveConfig } from '../agent/Config.js';
import { AgentLoop } from '../agent/AgentLoop.js';
import { MemoryEngine } from '../agent/MemoryEngine.js';
import type { ToolRegistry } from '../tools/Registry.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';

function cryptoRandomId(): string {
  return crypto.randomBytes(6).toString('hex');
}

// Convert markdown to plain text for chat platforms (Telegram/Discord/WA)
// Strips all markdown formatting: bold, headers, code blocks, backticks, etc.
function stripMarkdown(text: string): string {
  return (
    safeDisplayText(text)
      // Remove code blocks (```...```)
      .replace(/```[\s\S]*?```/g, (match) => {
        // Extract code content without the fences
        return match
          .replace(/^```[a-z]*\n?/g, '')
          .replace(/```$/g, '')
          .trim();
      })
      // Remove inline code backticks
      .replace(/`([^`]+)`/g, '$1')
      // Convert **bold** and __bold__ to UPPERCASE for emphasis
      .replace(/\*\*([^*]+)\*\*/g, (_, t) => t.toUpperCase())
      .replace(/__([^_]+)__/g, (_, t) => t.toUpperCase())
      // Convert *italic* and _italic_ to plain text
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
      .replace(/(?<!_)_([^_]+)_(?!_)/g, '$1')
      // Convert # headers to plain text (remove # prefix)
      .replace(/^#{1,6}\s+/gm, '')
      // Remove ^ carets
      .replace(/\^/g, '')
      // Remove ~~strikethrough~~
      .replace(/~~([^~]+)~~/g, '$1')
      // Remove [links](url) — keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove > blockquotes prefix
      .replace(/^>\s?/gm, '')
      // Clean up extra whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export interface IncomingMessage {
  platform: string;
  authorId: string;
  authorName: string;
  channelId: string;
  content: string;
  replyTo?: string;
  forwardedFrom?: string;
  attachments?: { type: string; url?: string; filename?: string }[];
}

export interface Platform {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(
    content: string,
    channelId: string,
    replyTo?: string,
    options?: any
  ): Promise<void | { messageId?: string }>;
  sendFile?(filePath: string, channelId: string, caption?: string, replyTo?: string): Promise<void>;
  edit?(content: string, channelId: string, messageId: string, options?: any): Promise<void>;
  react?(channelId: string, messageId: string, emoji: string): Promise<void>;
  typing?(channelId: string): Promise<void>;
  on(event: 'message', handler: (msg: IncomingMessage) => void): this;
}

const COMMAND_GUIDE = `⏳ *AURIX Agent* — Multi-Agent AI Assistant

📋 *ALL COMMANDS:*

*Session:*
  /start — Show this guide
  /help — Quick help
  /reset — Clear conversation
  /cancel — Stop current task (unlocks queue)
  /title [name] — Name & save session (auto-random if no name)
  /resume [name] — Load a saved session (list if no name)
  /save — Save current session
  /status — Model, provider, uptime
  /history — Message count

*Configuration:*
  /model <name> — Switch AI model
  /baseurl <url> — Change API base URL
  /apikey <key> — Set API key
  /depth <level> — Research depth (low/medium/high/xhigh/max/ultra)
  /fast — Toggle fast mode

*Tools & Skills:*
  /tools — List available tools
  /skills — List available skills

*AI Features:*
  /review — AI code review
  /plan — Planning mode
  /research <topic> — Deep research with sources
  /research-forums <topic> — Research on Reddit, X, YouTube, HN, etc.
  /summarize — Summarize long text

*Documents:*
  /pdf <content> — Generate PDF document
  /pptx <topic> — Generate PowerPoint
  /xlsx <topic> — Generate Excel spreadsheet

*Advanced:*
  /compress — Compress context
  /agents — Show active agents
  /btw <text> — Add context while agent is working

💡 *RESEARCH DEPTH:*
  low — Quick single-agent answers
  medium — Research + sources
  high — Full team + citations (multi-agent)
  xhigh — + Debate system
  max — + Logic critic
  ultra — + Final review loop (publication-grade)

💡 *TIPS:*
  Just type your question to start.
  Use /depth to control thoroughness.
  Journal/scientific answers include sources.`;

const WA_COMMAND_GUIDE = `⏳ *AURIX Agent* — Multi-Agent AI Assistant

📋 *ALL COMMANDS:*

*Session:*
  !ai start — Show this guide
  !ai help — Quick help
  !ai reset — Clear conversation
  !ai cancel — Stop current task
  !ai status — Model, provider, uptime
  !ai history — Message count

*Configuration:*
  !ai model <name> — Switch AI model
  !ai depth <level> — Research depth

*Tools & Skills:*
  !ai tools — List available tools
  !ai skills — List available skills

*AI Features:*
  !ai review — AI code review
  !ai plan — Planning mode
  !ai research <topic> — Deep research
  !ai research-forums <topic> — Research on Reddit, X, YouTube
  !ai summarize — Summarize text

*Documents:*
  !ai pdf <content> — Generate PDF
  !ai pptx <topic> — Generate PowerPoint
  !ai xlsx <topic> — Generate Excel

💡 Just type your question after !ai
Example: !ai make a python loop script`;

const MINI_GUIDE = `Hi! I'm AURIX Agent ⏳
Type /start for all commands, or just ask me anything.
Research: /depth low|medium|high|xhigh|max|ultra`;

const WA_MINI_GUIDE = `Hi! I'm AURIX Agent ⏳
Type !ai start for all commands.
Example: !ai make me a python script`;

const VALID_DEPTHS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const KNOWN_COMMANDS = new Set([
  'start',
  'help',
  'reset',
  'cancel',
  'title',
  'resume',
  'save',
  'status',
  'history',
  'model',
  'baseurl',
  'apikey',
  'depth',
  'fast',
  'tools',
  'skills',
  'review',
  'plan',
  'research',
  'research-forums',
  'summarize',
  'pdf',
  'pptx',
  'xlsx',
  'compress',
  'agents',
  'btw',
  'proxy',
  'login',
]);

const STATUS_EMOJIS: Record<string, string> = {
  thinking: '❄️',
  tool_start: '❄️',
  text: '❄️',
  done: '✅',
  error: '❌',
};

function formatStatus(status: string, detail?: string): string {
  const emoji = STATUS_EMOJIS[status] || '❄️';
  const label: Record<string, string> = {
    thinking: 'Thinking...',
    tool_start: `using_tools: ${detail || 'tool'}`,
    text: 'Writing response...',
    done: 'Done!',
    error: 'Error',
  };
  return `${emoji} ${label[status] || status}`;
}

const SOURCE_LABELS: Record<string, string> = {
  reddit: 'Reddit',
  x: 'X/Twitter',
  twitter: 'X/Twitter',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  hackernews: 'Hacker News',
  polymarket: 'Polymarket',
  github: 'GitHub',
  instagram: 'Instagram',
  bluesky: 'Bluesky',
  threads: 'Threads',
  pinterest: 'Pinterest',
  web: 'Web',
  digg: 'Digg',
  truthsocial: 'Truth Social',
  facebook: 'Facebook',
};

function shortPath(value?: unknown): string {
  const file = value ? String(value) : '';
  return file.split('/').pop() || file;
}

function truncateLines(text: string, maxLines = 30, maxLineLength = 140): string {
  const lines = safeDisplayText(text)
    .split('\n')
    .map((line) => (line.length > maxLineLength ? line.slice(0, maxLineLength - 1) + '…' : line));
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(0, maxLines).join('\n') + `\n… (${lines.length - maxLines} more lines)`;
}

function formatToolStatus(toolName: string, args?: Record<string, unknown>): string {
  const name = toolName || 'tool';
  const lower = name.toLowerCase();
  const file = args?.file_path || args?.path;
  const query = args?.query ? String(args.query) : '';
  const url = args?.url ? String(args.url) : '';
  const target = args?.target ? String(args.target) : '';
  const detail = query || url || target;

  if (lower === 'terminal' || lower === 'bash' || lower === 'code_exec') {
    const command = args?.command || args?.code || '';
    const lang = lower === 'code_exec' ? String(args?.language || 'code') : 'shell';
    const label = lower === 'code_exec' ? 'Executing Code' : 'Running Terminal';
    return `🖥️ **${label}**\n\n\`\`\`${lang}\n${truncateLines(String(command || '(no command)'), 30)}\n\`\`\``;
  }

  if (lower === 'spawn_agent') {
    const role = args?.role || args?.agent || args?.specialist || args?.name || 'specialist';
    const task = args?.task || args?.prompt || query;
    return `🤖 **Spawning Agent**\n${String(role)}${task ? `\n${String(task).slice(0, 160)}` : ''}`;
  }

  if (lower === 'mcp_manage') {
    const action = args?.action ? String(args.action) : 'manage';
    const server = args?.server || args?.name || args?.package || '';
    return `🔌 **Managing MCP**\n${action}${server ? ` · ${String(server)}` : ''}`;
  }

  if (lower === 'web_fetch' || lower === 'web_scrape') {
    return `🌐 **Fetching Web**${url ? `\n${url}` : query ? `\n${query}` : ''}`;
  }

  if (lower === 'web_search') {
    return `🔎 **Searching Web**${query ? `\n${query}` : ''}`;
  }

  if (lower === 'youtube_transcript') {
    const video = url || query || String(args?.video_id || args?.id || 'YouTube video');
    return `▶️ **Reading YouTube Transcript**\n${video}`;
  }

  if (lower === 'research' || lower === 'china_ai_research') {
    const depth = args?.depth ? ` (${String(args.depth)})` : '';
    const label = lower === 'china_ai_research' ? 'Researching China AI' : 'Researching';
    return `🔬 **${label}**${depth}${query ? `\n${query}` : ''}`;
  }

  if (lower === 'research_forums') {
    const sources = args?.sources
      ? String(args.sources)
          .split(',')
          .map((s) => SOURCE_LABELS[s.trim().toLowerCase()] || s.trim())
      : ['Reddit', 'X/Twitter', 'YouTube', 'Hacker News', 'GitHub', 'Web'];
    return `💬 **Scanning Forums**\n${sources.join(', ')}`;
  }

  if (lower === 'browser') {
    const action = args?.action ? String(args.action) : 'action';
    const browserTarget = args?.target ? ` → ${String(args.target).slice(0, 80)}` : '';
    const value = args?.value ? `\n${String(args.value).slice(0, 120)}` : '';
    return `🧭 **Browser ${action}**${browserTarget}${value}`;
  }

  if (lower === 'read_file' || lower === 'read_archive') {
    const range = args?.offset ? `:${String(args.offset)}` : '';
    const label = lower === 'read_archive' ? 'Reading Archive' : 'Reading File';
    return `📖 **${label}**\n${shortPath(file)}${range}`;
  }

  if (lower === 'write_file') {
    return `✍️ **Writing File**\n${shortPath(file)}`;
  }

  if (lower === 'file_edit') {
    const line = args?.line || args?.offset ? ` line ${String(args.line || args.offset)}` : '';
    return `📝 **Editing File${line}**\n${shortPath(file)}`;
  }

  if (lower === 'delete_file' || lower === 'delete_folder') {
    const label = lower === 'delete_folder' ? 'Deleting Folder' : 'Deleting File';
    return `🗑️ **${label}**\n${shortPath(file)}`;
  }

  if (lower === 'search_files') {
    const pattern = args?.pattern ? String(args.pattern).slice(0, 80) : '';
    const where = args?.path ? ` in ${String(args.path)}` : '';
    return `🔍 **Searching Files**\n${pattern}${where}`;
  }

  if (lower.startsWith('git_') || lower.startsWith('gh_') || lower.includes('github')) {
    const gitLabels: Record<string, string> = {
      git_advanced: 'Advanced Git',
      gh_pr_create: 'Creating GitHub PR',
      gh_issue_create: 'Creating GitHub Issue',
      gh_pr_list: 'Listing GitHub PRs',
      gh_repo_info: 'Reading GitHub Repo',
      github_connect: 'Connecting GitHub',
      github_pr: 'Working GitHub PR',
      github_issue: 'Working GitHub Issue',
      github_search: 'Searching GitHub',
    };
    return `🐙 **${gitLabels[lower] || 'GitHub / Git'}**\n${detail || name}`;
  }

  const documentLabels: Record<string, string> = {
    pdf: 'Generating PDF',
    generate_pptx: 'Generating Slides',
    generate_excel: 'Generating Spreadsheet',
    email: 'Composing Email',
  };
  if (documentLabels[lower]) {
    return `📄 **${documentLabels[lower]}**\n${shortPath(file) || detail || name}`;
  }

  if (lower === 'send_file') {
    return `📎 **Sending File**\n${shortPath(file)}`;
  }

  if (lower === 'ask_user') {
    return `❓ **Asking User**`;
  }

  if (lower === 'todo' || lower === 'planning') {
    const label = lower === 'todo' ? 'Updating Tasks' : 'Planning';
    return `📋 **${label}**\n${detail || name}`;
  }

  if (lower === 'memory') {
    const action = args?.action ? String(args.action) : 'update';
    return `🧠 **Updating Memory**\n${action}`;
  }

  if (lower === 'skill_loader') {
    return `📚 **Loading Skill**\n${detail || String(args?.skill || args?.name || name)}`;
  }

  if (lower === 'system_info') {
    return `📊 **Checking System**\nCPU · memory · disk`;
  }

  if (lower === 'docker_manage') {
    const action = args?.action ? String(args.action) : 'manage';
    const service = args?.container || args?.image || args?.service || args?.name || '';
    return `🐳 **Managing Docker**\n${action}${service ? ` · ${String(service)}` : ''}`;
  }

  if (lower === 'vps') {
    const action = args?.action ? String(args.action) : 'manage';
    return `🖧 **Managing VPS**\n${action}${detail ? ` · ${detail}` : ''}`;
  }

  const cloudLabels: Record<string, string> = {
    gcloud_status: 'Checking Google Cloud',
    gcloud_deploy: 'Deploying to Google Cloud',
    aws_status: 'Checking AWS',
    aws_deploy: 'Deploying to AWS',
    cloud_cost: 'Checking Cloud Cost',
  };
  if (cloudLabels[lower]) {
    const project = args?.project || args?.service || args?.region || '';
    return `☁️ **${cloudLabels[lower]}**${project ? `\n${String(project)}` : ''}`;
  }

  const deployLabels: Record<string, string> = {
    deploy_vercel: 'Deploying to Vercel',
    deploy_github_pages: 'Deploying GitHub Pages',
    setup_ci: 'Setting Up CI',
    deploy_status: 'Checking Deploy Status',
  };
  if (deployLabels[lower]) {
    return `🚀 **${deployLabels[lower]}**${detail ? `\n${detail}` : ''}`;
  }

  const frontendLabels: Record<string, string> = {
    scaffold_project: 'Scaffolding Frontend',
    generate_component: 'Generating Component',
    build_check: 'Checking Frontend Build',
  };
  if (frontendLabels[lower]) {
    const subject = args?.component || args?.framework || args?.project || args?.name || detail;
    return `🎨 **${frontendLabels[lower]}**${subject ? `\n${String(subject)}` : ''}`;
  }

  const backendLabels: Record<string, string> = {
    scaffold_api: 'Scaffolding API',
    generate_schema: 'Generating Schema',
    generate_endpoint: 'Generating Endpoint',
    setup_auth: 'Setting Up Auth',
    generate_dockerfile: 'Generating Dockerfile',
  };
  if (backendLabels[lower]) {
    const subject = args?.endpoint || args?.schema || args?.framework || args?.name || detail;
    return `🧱 **${backendLabels[lower]}**${subject ? `\n${String(subject)}` : ''}`;
  }

  if (lower === 'evm_wallet') {
    const action = args?.action ? String(args.action) : 'wallet';
    return `⛓️ **EVM Wallet**\n${action}${detail ? ` · ${detail}` : ''}`;
  }

  if (lower === 'solana_wallet') {
    const action = args?.action ? String(args.action) : 'wallet';
    return `◎ **Solana Wallet**\n${action}${detail ? ` · ${detail}` : ''}`;
  }

  if (lower === 'trading') {
    const symbol = args?.symbol || args?.pair || args?.asset || detail;
    return `📈 **Trading Analysis**${symbol ? `\n${String(symbol)}` : ''}`;
  }

  if (lower === 'maps_lookup') {
    return `🗺️ **Looking Up Maps**${detail ? `\n${detail}` : ''}`;
  }

  if (lower === 'music') {
    return `🎧 **Working with Music**${detail ? `\n${detail}` : ''}`;
  }

  if (lower === 'setup_notifier') {
    return `🔔 **Setting Up Notifier**${detail ? `\n${detail}` : ''}`;
  }

  if (lower === 'humanize_text') {
    return `✨ **Humanizing Text**`;
  }

  if (lower.includes('osint') || lower.includes('cybersec')) {
    const label = lower.includes('osint') ? 'OSINT Investigation' : 'Security Research';
    return `🛡️ **${label}**\n${detail || name}`;
  }

  if (lower === 'generate_diagram') {
    return `🗺️ **Generating Diagram**${detail ? `\n${detail}` : ''}`;
  }

  if (lower === 'gif_search') {
    return `🖼️ **Searching GIFs**${query ? `\n${query}` : ''}`;
  }

  if (lower.includes('image') || lower.includes('diagram') || lower.includes('gif')) {
    return `🖼️ **Generating Visual**\n${name}`;
  }

  return `🧰 **${name}**`;
}

function cleanResponse(text: string): string {
  return safeDisplayText(text)
    .replace(/\$([^\s$][^$\n]*[^\s$])\$/g, '')
    .replace(/^>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SENDABLE_FILE_RE =
  /(?:Screenshot saved(?: to)?|Screenshot|saved(?: to)?|Saved to|Output(?: file)?|File):\s*([^\s\n]+\.(?:png|jpg|jpeg|gif|webp|pdf|pptx|xlsx|docx|zip|txt|json))/gi;

function extractSendableFiles(text: string): string[] {
  const files = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = SENDABLE_FILE_RE.exec(text)) !== null) {
    const file = match[1].replace(/[)\].,;]+$/, '');
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) files.add(file);
    } catch {}
  }
  return [...files];
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) || 0;
  if (code === 0x200d || (code >= 0x0300 && code <= 0x036f) || (code >= 0xfe00 && code <= 0xfe0f))
    return 0;
  if (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff))
  )
    return 2;
  return 1;
}

function displayWidth(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + charWidth(char), 0);
}

function truncateDisplay(text: string, width: number): string {
  let out = '';
  let used = 0;
  for (const char of Array.from(text)) {
    const next = used + charWidth(char);
    if (next > width) break;
    out += char;
    used = next;
  }
  return out;
}

function wrapDisplay(text: string, width: number): string[] {
  const value = (text || '').trim();
  if (!value) return [''];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  const pushHardWrapped = (word: string) => {
    let remaining = word;
    while (displayWidth(remaining) > width) {
      const part = truncateDisplay(remaining, width);
      lines.push(part);
      remaining = Array.from(remaining).slice(Array.from(part).length).join('');
    }
    current = remaining;
  };

  for (const word of words) {
    if (!current) {
      if (displayWidth(word) > width) pushHardWrapped(word);
      else current = word;
      continue;
    }
    const candidate = `${current} ${word}`;
    if (displayWidth(candidate) <= width) current = candidate;
    else {
      lines.push(current);
      if (displayWidth(word) > width) pushHardWrapped(word);
      else current = word;
    }
  }

  if (current || lines.length === 0) lines.push(current);
  return lines.slice(0, 6);
}

function parseMarkdownTable(
  lines: string[],
  start: number
): { next: number; table: string } | null {
  if (!lines[start]?.trim().startsWith('|')) return null;
  const rows: string[] = [];
  let i = start;
  while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].includes('|', 1)) {
    rows.push(lines[i]);
    i++;
  }
  if (rows.length < 2) return null;
  const parseRow = (row: string) =>
    row
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
  const sepIdx = rows.findIndex((r, idx) => idx > 0 && /^[\s|:-]+$/.test(r.trim()));
  if (sepIdx < 1) return null;
  const headers = parseRow(rows[0]);
  const body = rows.filter((_, idx) => idx !== 0 && idx !== sepIdx).map(parseRow);
  if (headers.length === 0 || body.length === 0) return null;
  const colCount = Math.max(headers.length, ...body.map((r) => r.length));
  const normalizedHeaders = Array.from(
    { length: colCount },
    (_, c) => headers[c] || `Column ${c + 1}`
  );
  const normalizedBody = body.map((row) =>
    Array.from({ length: colCount }, (_, c) => row[c] || '')
  );
  const widths = normalizedHeaders.map((h, c) => {
    let max = displayWidth(h);
    for (const row of normalizedBody) max = Math.max(max, displayWidth(row[c] || ''));
    return Math.min(Math.max(max, 6), 18);
  });
  let totalWidth = widths.reduce((sum, w) => sum + w + 3, 1);
  while (totalWidth > 74 && widths.some((w) => w > 8)) {
    let widest = 0;
    for (let idx = 1; idx < widths.length; idx++) {
      if (widths[idx] > widths[widest]) widest = idx;
    }
    widths[widest] -= 1;
    totalWidth = widths.reduce((sum, w) => sum + w + 3, 1);
  }
  const pad = (value: string, width: number) => {
    const clean = truncateDisplay(value || '', width);
    return clean + ' '.repeat(Math.max(0, width - displayWidth(clean)));
  };
  const border = (left: string, mid: string, right: string) =>
    left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right;
  const rowLines = (cells: string[]) => {
    const wrapped = widths.map((width, c) => wrapDisplay(cells[c] || '', width));
    const height = Math.max(...wrapped.map((cell) => cell.length), 1);
    return Array.from({ length: height }, (_, lineIdx) => {
      return (
        '│' +
        Array.from(
          { length: colCount },
          (_, c) => ` ${pad(wrapped[c][lineIdx] || '', widths[c])} `
        ).join('│') +
        '│'
      );
    });
  };
  const out = [
    border('┌', '┬', '┐'),
    ...rowLines(normalizedHeaders),
    border('├', '┼', '┤'),
    ...normalizedBody.flatMap(rowLines),
    border('└', '┴', '┘'),
  ].join('\n');
  return { next: i, table: out };
}

function formatMarkdownTablesForTelegram(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const table = parseMarkdownTable(lines, i);
    if (table) {
      out.push('```text', table.table, '```');
      i = table.next;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join('\n');
}

function renderInlineTelegramHtml(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<b>$1</b>');
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>');
  out = out.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<i>$1</i>');
  out = out.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  return out;
}

function markdownToTelegramHtml(text: string): string {
  const blocks: string[] = [];
  const withBlocks = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, _lang, code) => {
    const token = `@@AURIX_BLOCK_${blocks.length}@@`;
    blocks.push(`<pre>${escapeHtml(String(code).trim())}</pre>`);
    return token;
  });

  const rendered = withBlocks
    .split('\n')
    .map((line) => {
      const blockMatch = line.match(/^@@AURIX_BLOCK_(\d+)@@$/);
      if (blockMatch) return blocks[Number(blockMatch[1])] || '';
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) return `<b>${renderInlineTelegramHtml(heading[2])}</b>`;
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) return `<blockquote>${renderInlineTelegramHtml(quote[1])}</blockquote>`;
      return renderInlineTelegramHtml(line);
    })
    .join('\n');

  return rendered.replace(/@@AURIX_BLOCK_(\d+)@@/g, (_, idx) => blocks[Number(idx)] || '');
}

function gatewayText(text: string, platformName?: string): { text: string; options?: any } {
  const cleaned = cleanResponse(text);
  if (platformName === 'telegram') {
    return {
      text: markdownToTelegramHtml(formatMarkdownTablesForTelegram(cleaned)),
      options: { parse_mode: 'HTML', disable_web_page_preview: true },
    };
  }
  return { text: stripMarkdown(cleaned) };
}

function gatewayPlainText(text: string): string {
  return stripMarkdown(cleanResponse(text));
}

function isProgressPlatform(platform: Platform): boolean {
  return platform.name === 'telegram' && typeof platform.edit === 'function';
}

async function sendGatewayMessage(
  platform: Platform,
  content: string,
  channelId: string,
  replyTo?: string,
  options?: any
): Promise<string | undefined> {
  const result = await platform.send(content, channelId, replyTo, options);
  return result && typeof result === 'object' ? result.messageId : undefined;
}

export class Gateway extends EventEmitter {
  private platforms = new Map<string, Platform>();
  private agents = new Map<string, AgentLoop>();
  private config: AurixConfig;
  private registry: ToolRegistry;
  private firstTimeUsers = new Set<string>();
  private userDepths = new Map<string, string>();
  private startTime: number;
  private processing = new Set<string>();
  private activeProcessing = new Set<string>();
  private lastContext = new Map<
    string,
    { platform: string; channelId: string; replyTo?: string }
  >();
  private sessionNames = new Map<string, string>();
  private messageQueue = new Map<string, IncomingMessage>();

  constructor(config: AurixConfig, registry: ToolRegistry) {
    super();
    this.config = config;
    this.registry = registry;
    this.startTime = Date.now();

    setGlobalAskCallback((sessionKey, question, toolOptions) => {
      if (sessionKey === 'default') {
        let msg = `[AskUser] ${question}`;
        if (toolOptions && toolOptions.length > 0) {
          msg += `\nOptions: ${toolOptions.join(', ')}`;
        }
        console.log(msg);
        return;
      }

      const ctx = this.lastContext.get(sessionKey);
      if (ctx) {
        const platform = this.platforms.get(ctx.platform);
        if (platform) {
          const isYesNo =
            question.toLowerCase().includes('yes/no') ||
            question.toLowerCase().includes('yes or no') ||
            question.toLowerCase().includes('proceed?');

          let sendOptions: any = undefined;

          if (platform.name === 'telegram') {
            if (toolOptions && toolOptions.length > 0) {
              // Convert toolOptions array into inline keyboard layout (1 button per row to handle long text safely)
              const keyboard = [
                ...toolOptions.map((opt) => [{ text: opt, callback_data: opt }]),
                [{ text: '✍️ Type Your Answer', callback_data: '__aurix_type_answer__' }],
              ];
              sendOptions = {
                reply_markup: {
                  inline_keyboard: keyboard,
                },
              };
            } else if (isYesNo) {
              sendOptions = {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '✅ Yes', callback_data: 'yes' },
                      { text: '❌ No', callback_data: 'no' },
                    ],
                  ],
                },
              };
            }
          }

          let promptText = `❓ Question from agent:\n${question}\n\nPlease reply to answer.`;
          if (toolOptions && toolOptions.length > 0 && platform.name !== 'telegram') {
            // For platforms that don't support inline keyboards (like discord or whatsapp currently), append options to text
            promptText +=
              `\n\nOptions:\n` + toolOptions.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
          }

          const rendered = gatewayText(promptText, platform.name);
          platform
            .send(rendered.text, ctx.channelId, ctx.replyTo, {
              ...(rendered.options || {}),
              ...(sendOptions || {}),
            })
            .catch((e) => console.error(e));
        }
      }
    });
  }

  register(platform: Platform): void {
    this.platforms.set(platform.name, platform);
    platform.on('message', (msg) => this.handleMessage(msg));
  }

  private getAgent(key: string): AgentLoop {
    let agent = this.agents.get(key);
    if (!agent) {
      agent = new AgentLoop(this.config, this.registry);
      agent.setSessionKey(key);
      this.agents.set(key, agent);
    }
    return agent;
  }

  private getUserKey(msg: IncomingMessage): string {
    return `${msg.platform}:${msg.authorId}`;
  }

  private isUserAllowed(msg: IncomingMessage): boolean {
    const gw = this.config.gateway;
    if (!gw) return true;
    let allowed: string[] | undefined;
    if (msg.platform === 'telegram') allowed = gw.telegram?.allowedUsers;
    else if (msg.platform === 'discord') allowed = gw.discord?.allowedUsers;
    else if (msg.platform === 'whatsapp') allowed = gw.whatsapp?.allowedUsers;
    if (!allowed || allowed.length === 0) return true;
    return allowed.includes(msg.authorId);
  }

  private getUptime(): string {
    const seconds = Math.floor((Date.now() - this.startTime) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  private isWhatsApp(msg: IncomingMessage): boolean {
    return msg.platform === 'whatsapp';
  }

  private normalizeCommand(text: string, platform: string): { cmd: string; args: string } {
    const trimmed = text.trim();
    if (platform === 'whatsapp') {
      if (trimmed.toLowerCase().startsWith('!ai')) {
        const rest = trimmed.slice(3).trim();
        const parts = rest.split(/\s+/);
        const first = (parts[0] || '').toLowerCase();
        if (!first || !KNOWN_COMMANDS.has(first)) return { cmd: '', args: rest };
        return { cmd: first, args: parts.slice(1).join(' ') };
      }
      return { cmd: '', args: trimmed };
    }
    const parts = trimmed.split(/\s+/);
    if (parts[0].startsWith('/')) {
      const cmd = parts[0].toLowerCase().slice(1);
      return { cmd, args: parts.slice(1).join(' ') };
    }
    return { cmd: '', args: trimmed };
  }

  private async handleMessage(msg: IncomingMessage) {
    const agentKey = this.getUserKey(msg);
    const platform = this.platforms.get(msg.platform);

    if (!platform) return;

    let text = msg.content.trim();
    const isWA = this.isWhatsApp(msg);
    const { cmd, args } = this.normalizeCommand(text, msg.platform);

    // Allow /btw and /cancel through even while agent is processing
    if (cmd !== 'btw' && cmd !== 'cancel') {
      if (this.processing.has(agentKey)) return;
    }

    // Guard: prevent concurrent processing for the same user
    // (queue processing via setImmediate can race with a new message)
    this.processing.add(agentKey);
    try {
      if (AskUserManager.isWaiting(agentKey)) {
        if (msg.content.trim() === '__aurix_type_answer__') {
          const rendered = gatewayText(
            '✍️ **Type your answer**\nReply with your custom answer now.',
            platform.name
          );
          await platform.send(rendered.text, msg.channelId, msg.replyTo, rendered.options);
          return;
        }
        AskUserManager.submitAnswer(agentKey, msg.content.trim());
        return;
      }

      this.lastContext.set(agentKey, {
        platform: msg.platform,
        channelId: msg.channelId,
        replyTo: msg.replyTo,
      });

      if (!this.isUserAllowed(msg)) {
        await platform.send(
          '🔒 Access denied. Your user ID is not in the allowed list for this bot.',
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'cancel') {
        if (this.activeProcessing.has(agentKey)) {
          const agent = this.agents.get(agentKey);
          if (agent) agent.interrupt();
          this.activeProcessing.delete(agentKey);
          this.messageQueue.delete(agentKey);
          await platform.send('🛑 Task cancelled. Queue cleared.', msg.channelId, msg.replyTo);
        } else {
          await platform.send('No active task to cancel.', msg.channelId, msg.replyTo);
        }
        return;
      }

      if (cmd === 'proxy') {
        const proxyRegex = /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}(:[^:\s]+:[^:\s]+)?$/;
        const proxyLines = args
          .split(/[\s\n]+/)
          .map((l) => l.trim())
          .filter((l) => proxyRegex.test(l));
        if (proxyLines.length === 0) {
          await platform.send(
            '🌐 Usage: /proxy <ip:port:user:pass>\nPaste one or more proxies (one per line).',
            msg.channelId,
            msg.replyTo
          );
          return;
        }
        try {
          const config = loadConfig();
          if (!config.browser) config.browser = {};
          if (!config.browser.proxies) config.browser.proxies = [];
          let added = 0;
          for (const line of proxyLines) {
            if (!config.browser.proxies.includes(line)) {
              config.browser.proxies.push(line);
              added++;
            }
          }
          if (added > 0) {
            saveConfig(config);
            await platform.send(
              `🌐 ${added} proxy added (total: ${config.browser.proxies.length}).`,
              msg.channelId,
              msg.replyTo
            );
          } else {
            await platform.send(
              `🌐 All proxies already exist (total: ${config.browser.proxies!.length}).`,
              msg.channelId,
              msg.replyTo
            );
          }
        } catch (e: any) {
          await platform.send(`Failed to save proxies: ${e.message}`, msg.channelId, msg.replyTo);
        }
        return;
      }

      // /btw — inject additional context while agent is working
      if (cmd === 'btw') {
        const btwText = args || '';
        const agent = this.agents.get(agentKey);
        const isActive = agent && this.activeProcessing.has(agentKey);

        if (!btwText) {
          // No args — show current status
          if (isActive) {
            const ledger = agent.getLedger();
            const totalTokens = ledger.total();
            await platform.send(
              `❄️ Agent is working...\nTokens used: ${totalTokens}`,
              msg.channelId,
              msg.replyTo
            );
          } else {
            await platform.send(
              '❄️ No active task. Use /btw <text> to inject context.',
              msg.channelId,
              msg.replyTo
            );
          }
          return;
        }

        if (isActive) {
          agent.injectContext(`[User added context while you were working]: ${btwText}`);
          await platform.send(`❄️ Context injected into current task.`, msg.channelId, msg.replyTo);
        } else {
          await platform.send(
            `❄️ No active task. Sending as new message...`,
            msg.channelId,
            msg.replyTo
          );
          msg.content = btwText;
          setImmediate(() => this.handleMessage(msg));
        }
        return;
      }

      if (this.activeProcessing.has(agentKey)) {
        this.messageQueue.set(agentKey, msg);
        await platform.send(
          stripMarkdown(
            '📋 Task queued. Current task still running — your message will be processed after it finishes.\nUse /cancel to stop the current task.'
          ),
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      this.emit('message', msg);

      if (isWA && !text.toLowerCase().startsWith('!ai')) {
        return;
      }

      if (cmd === 'start') {
        await platform.send(
          stripMarkdown(isWA ? WA_COMMAND_GUIDE : COMMAND_GUIDE),
          msg.channelId,
          msg.replyTo
        );
        this.firstTimeUsers.add(agentKey);
        return;
      }

      if (cmd === 'help') {
        const helpText = isWA
          ? `⏳ AURIX Quick Help\n\n!ai start — Full guide\n!ai reset — Clear context\n!ai model <name> — Switch model\n!ai depth <level> — Research depth\n!ai tools — List tools\n!ai status — Show status\n\nOr just type: !ai <your question>`
          : `⏳ AURIX Quick Help\n\n/start — Full guide\n/reset — Clear context\n/model <name> — Switch model\n/depth <level> — Research depth (low/medium/high/xhigh/max/ultra)\n/tools — List tools\n/skills — List skills\n/status — Show status\n/history — Message count\n\nOr just type your question!`;
        await platform.send(stripMarkdown(helpText), msg.channelId, msg.replyTo);
        return;
      }

      if (!this.firstTimeUsers.has(agentKey)) {
        this.firstTimeUsers.add(agentKey);
        await platform.send(
          stripMarkdown(isWA ? WA_MINI_GUIDE : MINI_GUIDE),
          msg.channelId,
          msg.replyTo
        );
      }

      if (cmd === 'reset') {
        try {
          this.agents.get(agentKey)?.interrupt();
          this.activeProcessing.delete(agentKey);
        } catch {}
        this.agents.delete(agentKey);
        await platform.send('✅ Context reset. Starting fresh.', msg.channelId, msg.replyTo);
        return;
      }

      if (cmd === 'model' && args) {
        const agent = this.getAgent(agentKey);
        agent.setProvider({ model: args });
        // Persist to config file
        this.config.model = args;
        saveConfig(this.config);
        console.log(`[Gateway] Model changed to: ${args}`);
        await platform.send(`✅ Model switched to: ${args}`, msg.channelId, msg.replyTo);
        return;
      }

      if (cmd === 'baseurl' && args) {
        const agent = this.getAgent(agentKey);
        agent.setProvider({ baseUrl: args });
        this.config.baseUrl = args;
        saveConfig(this.config);
        console.log(`[Gateway] Base URL changed to: ${args}`);
        await platform.send(`✅ Base URL switched to: ${args}`, msg.channelId, msg.replyTo);
        return;
      }

      if (cmd === 'apikey' && args) {
        const agent = this.getAgent(agentKey);
        agent.setProvider({ apiKey: args });
        this.config.apiKey = args;
        saveConfig(this.config);
        console.log(`[Gateway] API key updated`);
        await platform.send(`✅ API key updated.`, msg.channelId, msg.replyTo);
        return;
      }

      if (cmd === 'depth' && args) {
        const mode = args.toLowerCase();
        if (VALID_DEPTHS.includes(mode)) {
          this.userDepths.set(agentKey, mode);
          const agent = this.getAgent(agentKey);
          agent.setResearchMode(mode as any);
          this.config.researchMode = mode as any;
          saveConfig(this.config);
          const desc: Record<string, string> = {
            low: 'Single-agent normal execution',
            medium: 'Single-agent with light research discipline',
            high: 'Research prompts use pipeline; complex tasks use native multi-agent',
            xhigh: 'High routing plus debate/verifier stages when applicable',
            max: 'Force real research/multi-agent routing for eligible prompts',
            ultra: 'Maximum pipeline/final review or native multi-agent synthesis',
          };
          await platform.send(
            `✅ Research depth: ${mode}\n${desc[mode]}`,
            msg.channelId,
            msg.replyTo
          );
        } else {
          await platform.send(
            `❌ Invalid depth. Choose: ${VALID_DEPTHS.join(', ')}`,
            msg.channelId,
            msg.replyTo
          );
        }
        return;
      }

      if (cmd === 'tools') {
        const tools = this.registry.list();
        if (tools.length === 0) {
          await platform.send('No tools registered.', msg.channelId, msg.replyTo);
          return;
        }
        const toolList = tools
          .slice(0, 30)
          .map((t) => `  ✻ ${t.name} — ${t.description.slice(0, 50)}`)
          .join('\n');
        await platform.send(
          stripMarkdown(`✻ Available tools (${tools.length}):\n${toolList}`),
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'skills') {
        await platform.send(
          '📚 Skills listing coming soon. Check /tools for capabilities.',
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'status') {
        const agent = this.getAgent(agentKey);
        const depth = this.userDepths.get(agentKey) || 'low';
        const platforms = this.getPlatforms().join(', ');
        await platform.send(
          `⏳ AURIX Agent Status\n\n🤖 Model:    ${agent.getModel()}\n🔌 Provider: ${agent.getProviderName()}\n📊 Depth:    ${depth}\n⏱️ Uptime:   ${this.getUptime()}\n🌐 Platforms: ${platforms}`,
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'history') {
        const agent = this.getAgent(agentKey);
        const count = agent.getMessages().length;
        await platform.send(`📝 ${count} messages in conversation.`, msg.channelId, msg.replyTo);
        return;
      }

      if (cmd === 'save') {
        const agent = this.getAgent(agentKey);
        const name = this.sessionNames.get(agentKey);
        const sessionId = agent.saveSession(name);
        if (name) {
          await platform.send(
            `✅ Session saved as "${name}"!\nResume with: /resume ${name}`,
            msg.channelId,
            msg.replyTo
          );
        } else {
          await platform.send(
            `✅ Session saved!\nName it with: /title <name>\nResume with: /resume ${sessionId}`,
            msg.channelId,
            msg.replyTo
          );
        }
        return;
      }

      if (cmd === 'title') {
        const agent = this.getAgent(agentKey);
        let name = args.trim();
        if (!name) {
          name = 's-' + cryptoRandomId();
        }
        name = name
          .replace(/[^a-zA-Z0-9_-]/g, '-')
          .replace(/-+/g, '-')
          .slice(0, 40);
        this.sessionNames.set(agentKey, name);
        agent.saveSession(name);
        await platform.send(
          `💾 Session named: "${name}"\nAuto-saved. Resume anytime: /resume ${name}`,
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'resume') {
        let name = args.trim();
        const memory = new MemoryEngine();
        if (!name) {
          const sessions = memory.listSessions().slice(0, 10);
          if (sessions.length === 0) {
            await platform.send(
              'No saved CLI/gateway sessions found. Use /title <name> or exit AURIX CLI once to create one.',
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          const list = sessions
            .map((s, i) => `  ${i + 1}. ${s.id} — ${s.preview} (${s.messageCount} msg)`)
            .join('\n');
          await platform.send(
            `💾 Shared AURIX sessions:\n${list}\n\nResume any CLI or gateway session with: /resume <id>`,
            msg.channelId,
            msg.replyTo
          );
          return;
        }

        this.agents.get(agentKey)?.interrupt();
        this.activeProcessing.delete(agentKey);
        this.messageQueue.delete(agentKey);
        this.agents.delete(agentKey);
        const agent = this.getAgent(agentKey);
        const count = agent.loadSession(name);
        if (count > 0) {
          this.sessionNames.set(agentKey, name);
          await platform.send(
            `✅ Session "${name}" loaded (${count} messages).\nContinuing where you left off.`,
            msg.channelId,
            msg.replyTo
          );
        } else {
          await platform.send(
            `❌ Session "${name}" not found.\nUse /resume (no args) to list available sessions.`,
            msg.channelId,
            msg.replyTo
          );
        }
        return;
      }

      if (cmd === 'compress') {
        const agent = this.agents.get(agentKey);
        if (agent) {
          const removed = await agent.compactMessages();
          await platform.send(
            `✅ Compressed: removed ${removed} tool results from context.`,
            msg.channelId,
            msg.replyTo
          );
        } else {
          await platform.send('No active session to compress.', msg.channelId, msg.replyTo);
        }
        return;
      }

      if (cmd === 'fast') {
        this.userDepths.set(agentKey, 'low');
        const agent = this.getAgent(agentKey);
        agent.setResearchMode('low' as any);
        this.config.researchMode = 'low' as any;
        saveConfig(this.config);
        await platform.send(
          '⚡ Fast mode: low depth, single-agent normal execution.',
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'agents') {
        await platform.send(
          '🤖 Native routing: specialists are selected per task when /depth high+ or multi-agent routing applies. No fake always-on agents.',
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'review') {
        const reviewCode = args;
        if (!reviewCode) {
          await platform.send(
            '🔍 Usage: /review <code or paste>\nI will analyze your code for bugs, security, and improvements.',
            msg.channelId,
            msg.replyTo
          );
          return;
        }
        // Route as a code review prompt
        text = `[REVIEW REQUEST] Review the following code for bugs, security issues, and improvements:\n\n${reviewCode}`;
      }

      if (cmd === 'plan') {
        const planDesc = args;
        if (!planDesc) {
          await platform.send(
            '📋 Usage: /plan <project description>\nI will create an implementation plan with architecture and steps.',
            msg.channelId,
            msg.replyTo
          );
          return;
        }
        text = `[PLAN REQUEST] Create a detailed implementation plan for this project. Include architecture, file structure, and step-by-step tasks:\n\n${planDesc}`;
      }

      if (cmd === 'login') {
        await platform.send(
          '🔑 To update credentials:\n' +
            'Run `aurix setup` on your terminal.\n' +
            'Or set env vars: AURIX_API_KEY, AURIX_BASE_URL, AURIX_MODEL.',
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      const userPrompt = isWA ? args || text.replace(/^!ai\s*/i, '').trim() : text;
      if (!userPrompt) return;
      console.log(
        `[Gateway] Processing message from ${msg.platform} user=${msg.authorId}: "${userPrompt.slice(0, 80)}"`
      );

      const platformTag = `[sent from ${msg.platform}]`;
      const forwardTag = msg.forwardedFrom ? ` [forwarded from ${msg.forwardedFrom}]` : '';
      const imagePaths: string[] = [];
      const attachTag = msg.attachments?.length
        ? ' ' +
          msg.attachments
            .map((a) => {
              if (a.url && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(a.url)) {
                imagePaths.push(a.url);
              }
              return `[image: ${a.filename || a.url || 'attached'}]`;
            })
            .join(' ')
        : '';
      const taggedPrompt = `${platformTag}${forwardTag}${attachTag} ${userPrompt}`;

      const agent = this.getAgent(agentKey);
      const selectedDepth = this.userDepths.get(agentKey);
      if (selectedDepth) agent.setResearchMode(selectedDepth as any);
      this.activeProcessing.add(agentKey);

      try {
        let fullResponse = '';
        let lastToolStatus = '';
        const progressMode = isProgressPlatform(platform);
        let progressMessageId: string | undefined;
        let progressCanEdit = false;
        let sawToolStatus = false;

        await platform.react?.(msg.channelId, msg.replyTo || '', '👀');
        await platform.typing?.(msg.channelId);

        const thinking = gatewayText('🧠 **Thinking...**', platform.name);
        if (progressMode) {
          progressMessageId = await sendGatewayMessage(
            platform,
            thinking.text,
            msg.channelId,
            msg.replyTo,
            {
              ...(thinking.options || {}),
              disable_notification: true,
            }
          );
          progressCanEdit = Boolean(progressMessageId);
        } else {
          await platform.send(thinking.text, msg.channelId, msg.replyTo, thinking.options);
        }

        const publishProgress = async (rendered: { text: string; options?: any }) => {
          if (progressMode && progressCanEdit && progressMessageId && platform.edit) {
            await platform.edit(rendered.text, msg.channelId, progressMessageId, rendered.options);
            return;
          }
          const sentId = await sendGatewayMessage(
            platform,
            rendered.text,
            msg.channelId,
            msg.replyTo,
            {
              ...(rendered.options || {}),
              disable_notification: true,
            }
          );
          if (progressMode && sentId && !progressMessageId) {
            progressMessageId = sentId;
            progressCanEdit = true;
          }
        };

        for await (const event of agent.run(
          taggedPrompt,
          imagePaths.length > 0 ? imagePaths : undefined
        )) {
          if (event.type === 'tool_start') {
            const toolName = event.toolName || event.data;
            const args = event.toolArgs;
            const renderedStatus = gatewayText(formatToolStatus(toolName, args), platform.name);
            const newStatus = renderedStatus.text;
            if (newStatus !== lastToolStatus) {
              await publishProgress(renderedStatus);
              lastToolStatus = newStatus;
              sawToolStatus = true;
            }
          } else if (event.type === 'tool_end') {
            const files = extractSendableFiles(event.data);
            for (const file of files) {
              if (platform.sendFile) {
                await platform.sendFile(
                  file,
                  msg.channelId,
                  `${event.toolName || 'tool'} output`,
                  msg.replyTo
                );
              } else {
                const rendered = gatewayText(`File ready: ${file}`, platform.name);
                await platform.send(rendered.text, msg.channelId, msg.replyTo, rendered.options);
              }
            }
          } else if (event.type === 'text') {
            fullResponse += event.data;
          } else if (event.type === 'error') {
            const rendered = gatewayText(`❌ ${event.data}`, platform.name);
            await publishProgress(rendered);
            await platform.react?.(msg.channelId, msg.replyTo || '', '😢');
          } else if (event.type === 'compact') {
            const rendered = gatewayText(`📦 ${event.data}`, platform.name);
            await publishProgress(rendered);
          }
        }

        if (fullResponse) {
          const rendered = gatewayText(fullResponse, platform.name);
          const maxLen = platform.name === 'discord' ? 1900 : 4000;
          const chunks = splitMessage(rendered.text, maxLen);
          if (
            progressMode &&
            !sawToolStatus &&
            progressMessageId &&
            platform.edit &&
            chunks.length === 1
          ) {
            await platform.edit(chunks[0], msg.channelId, progressMessageId, rendered.options);
          } else {
            for (const chunk of chunks) {
              await platform.send(chunk, msg.channelId, msg.replyTo, rendered.options);
            }
          }
          await platform.react?.(msg.channelId, msg.replyTo || '', '✅');
        } else {
          console.error('[Gateway] Agent produced no response');
          const rendered = gatewayText(
            '❄️ Agent produced no response. Try again or use /reset.',
            platform.name
          );
          if (progressMode && progressMessageId && platform.edit) {
            await platform.edit(rendered.text, msg.channelId, progressMessageId, rendered.options);
          } else {
            await platform.send(rendered.text, msg.channelId, msg.replyTo, rendered.options);
          }
        }
      } catch (e: any) {
        console.error(`[Gateway] Error processing message: ${e.message}`);
        console.error(e.stack);
        await platform.react?.(msg.channelId, msg.replyTo || '', '😢');
        const rendered = gatewayText(`❌ Error: ${e.message}`, platform.name);
        await platform.send(rendered.text, msg.channelId, msg.replyTo, rendered.options);
      } finally {
        this.activeProcessing.delete(agentKey);
        this.processing.delete(agentKey);
      }

      this.emit('response', { msg, response: 'sent' });

      const queued = this.messageQueue.get(agentKey);
      if (queued) {
        this.messageQueue.delete(agentKey);
        await platform.send('▶️ Processing queued message...', queued.channelId, queued.replyTo);
        setImmediate(() => this.handleMessage(queued));
      }
    } finally {
      this.processing.delete(agentKey);
    }
  }

  async start(): Promise<void> {
    const results: string[] = [];

    for (const [name, platform] of this.platforms) {
      try {
        await platform.connect();
        results.push(`${name}: connected`);
      } catch (e: any) {
        results.push(`${name}: failed (${e.message})`);
      }
    }

    console.log('\n[AURIX Gateway]');
    results.forEach((r) => console.log(`  ${r}`));
    console.log();
  }

  async stop(): Promise<void> {
    for (const [, platform] of this.platforms) {
      try {
        await platform.disconnect();
      } catch {}
    }
  }

  getPlatforms(): string[] {
    return Array.from(this.platforms.keys());
  }

  getLastContext(
    userKey: string
  ): { platform: string; channelId: string; replyTo?: string } | undefined {
    return this.lastContext.get(userKey);
  }

  getMostRecentContext(): {
    userKey: string;
    platform: string;
    channelId: string;
    replyTo?: string;
  } | null {
    let latest: { userKey: string; platform: string; channelId: string; replyTo?: string } | null =
      null;
    for (const [userKey, ctx] of this.lastContext) {
      latest = { userKey, ...ctx };
    }
    return latest;
  }

  getAllContexts(): Array<{
    userKey: string;
    platform: string;
    channelId: string;
    replyTo?: string;
  }> {
    return Array.from(this.lastContext.entries()).map(([userKey, ctx]) => ({
      userKey,
      ...ctx,
    }));
  }

  getPlatform(name: string): Platform | undefined {
    return this.platforms.get(name);
  }

  async sendFileToUser(userKey: string, filePath: string, caption?: string): Promise<string> {
    const ctx = this.lastContext.get(userKey);
    if (!ctx)
      return 'No active conversation context found. The user needs to send a message first.';

    const platform = this.platforms.get(ctx.platform);
    if (!platform) return `Platform "${ctx.platform}" not found.`;
    if (!platform.sendFile) return `Platform "${ctx.platform}" does not support file sending.`;

    try {
      await platform.sendFile(filePath, ctx.channelId, caption, ctx.replyTo);
      return `File sent: ${filePath}`;
    } catch (e: any) {
      return `Failed to send file: ${e.message}`;
    }
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    // If single line is longer than maxLen, split it
    if (line.length > maxLen) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      // Split long line into chunks
      for (let i = 0; i < line.length; i += maxLen) {
        chunks.push(line.slice(i, i + maxLen));
      }
      continue;
    }

    if (current.length + line.length + 1 > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}
