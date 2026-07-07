import { safeDisplayText } from '../utils/terminal-sanitize.js';

export type ToolEventStatus = 'running' | 'success' | 'error' | 'timeout' | 'cancelled';

export interface ToolEventRenderInput {
  toolName?: string;
  args?: Record<string, unknown>;
  data?: string;
  durationMs?: number;
  status?: ToolEventStatus;
  errorType?: string;
}

export interface ToolEventRenderOptions {
  markdown?: boolean;
  includeResultPreview?: boolean;
  maxLines?: number;
  maxLineLength?: number;
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

function bold(text: string, markdown = true): string {
  return markdown ? `**${text}**` : text;
}

function codeBlock(lang: string, code: string, markdown = true): string {
  if (!markdown) return code;
  return `\`\`\`${lang}\n${code}\n\`\`\``;
}

export function formatDuration(durationMs?: number): string {
  if (durationMs === undefined || durationMs < 0 || !Number.isFinite(durationMs)) return '';
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m${seconds ? ` ${seconds}s` : ''}`;
}

export function truncateLines(text: string, maxLines = 30, maxLineLength = 140): string {
  const lines = safeDisplayText(text)
    .split('\n')
    .map((line) => (line.length > maxLineLength ? line.slice(0, maxLineLength - 1) + '…' : line));
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(0, maxLines).join('\n') + `\n… (${lines.length - maxLines} more lines)`;
}

function shortPath(value?: unknown): string {
  const file = value ? String(value) : '';
  return file.split('/').pop() || file;
}

function statusSuffix(input: ToolEventRenderInput): string {
  const duration = formatDuration(input.durationMs);
  const bits: string[] = [];
  if (input.status && input.status !== 'running') bits.push(input.status);
  if (duration) bits.push(duration);
  if (input.errorType && input.status !== 'success') bits.push(input.errorType);
  return bits.length ? ` — ${bits.join(' · ')}` : '';
}

export function renderToolStart(
  input: ToolEventRenderInput,
  options: ToolEventRenderOptions = {}
): string {
  const markdown = options.markdown ?? true;
  const args = input.args || {};
  const name = input.toolName || 'tool';
  const lower = name.toLowerCase();
  const file = args.file_path || args.path;
  const query = args.query ? String(args.query) : '';
  const url = args.url ? String(args.url) : '';
  const target = args.target ? String(args.target) : '';
  const detail = query || url || target;

  if (lower === 'terminal' || lower === 'bash' || lower === 'code_exec') {
    const command = args.command || args.code || '';
    const lang = lower === 'code_exec' ? String(args.language || 'code') : 'shell';
    const label = lower === 'code_exec' ? 'Executing Code' : 'Running Terminal';
    return `🖥️ ${bold(label, markdown)}\n\n${codeBlock(lang, truncateLines(String(command || '(no command)'), options.maxLines || 30, options.maxLineLength || 140), markdown)}`;
  }

  if (lower === 'spawn_agent') {
    const role = args.role || args.agent || args.specialist || args.name || 'specialist';
    const task = args.task || args.prompt || query;
    return `🤖 ${bold('Spawning Agent', markdown)}\n${String(role)}${task ? `\n${String(task).slice(0, 160)}` : ''}`;
  }

  if (lower === 'mcp_manage') {
    const action = args.action ? String(args.action) : 'manage';
    const server = args.server || args.name || args.package || '';
    return `🔌 ${bold('Managing MCP', markdown)}\n${action}${server ? ` · ${String(server)}` : ''}`;
  }

  if (lower === 'web_fetch' || lower === 'web_scrape')
    return `🌐 ${bold('Fetching Web', markdown)}${url ? `\n${url}` : query ? `\n${query}` : ''}`;
  if (lower === 'web_search')
    return `🔎 ${bold('Searching Web', markdown)}${query ? `\n${query}` : ''}`;
  if (lower === 'youtube_transcript') {
    const video = url || query || String(args.video_id || args.id || 'YouTube video');
    return `▶️ ${bold('Reading YouTube Transcript', markdown)}\n${video}`;
  }
  if (lower === 'research' || lower === 'china_ai_research') {
    const depth = args.depth ? ` (${String(args.depth)})` : '';
    const label = lower === 'china_ai_research' ? 'Researching China AI' : 'Researching';
    return `🔬 ${bold(label, markdown)}${depth}${query ? `\n${query}` : ''}`;
  }
  if (lower === 'research_forums') {
    const sources = args.sources
      ? String(args.sources)
          .split(',')
          .map((s) => SOURCE_LABELS[s.trim().toLowerCase()] || s.trim())
      : ['Reddit', 'X/Twitter', 'YouTube', 'Hacker News', 'GitHub', 'Web'];
    return `💬 ${bold('Scanning Forums', markdown)}\n${sources.join(', ')}`;
  }
  if (lower === 'browser') {
    const action = args.action ? String(args.action) : 'action';
    if (action === 'solve-captcha') return `🧩 ${bold('Solving Captcha', markdown)}`;
    const browserTarget = args.target ? ` → ${String(args.target).slice(0, 80)}` : '';
    const value = args.value ? `\n${String(args.value).slice(0, 120)}` : '';
    return `🧭 ${bold(`Browser ${action}`, markdown)}${browserTarget}${value}`;
  }
  if (lower === 'read_file' || lower === 'read_archive') {
    const range = args.offset ? `:${String(args.offset)}` : '';
    const label = lower === 'read_archive' ? 'Reading Archive' : 'Reading File';
    return `📖 ${bold(label, markdown)}\n${shortPath(file)}${range}`;
  }
  if (lower === 'write_file') return `✍️ ${bold('Writing File', markdown)}\n${shortPath(file)}`;
  if (lower === 'file_edit') {
    const line = args.line || args.offset ? ` line ${String(args.line || args.offset)}` : '';
    return `📝 ${bold(`Editing File${line}`, markdown)}\n${shortPath(file)}`;
  }
  if (lower === 'delete_file' || lower === 'delete_folder') {
    const label = lower === 'delete_folder' ? 'Deleting Folder' : 'Deleting File';
    return `🗑️ ${bold(label, markdown)}\n${shortPath(file)}`;
  }
  if (lower === 'search_files') {
    const pattern = args.pattern ? String(args.pattern).slice(0, 80) : '';
    const where = args.path ? ` in ${String(args.path)}` : '';
    return `🔍 ${bold('Searching Files', markdown)}\n${pattern}${where}`;
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
    return `🐙 ${bold(gitLabels[lower] || 'GitHub / Git', markdown)}\n${detail || name}`;
  }
  const documentLabels: Record<string, string> = {
    pdf: 'Generating PDF',
    generate_pptx: 'Generating Slides',
    generate_excel: 'Generating Spreadsheet',
    email: 'Composing Email',
  };
  if (documentLabels[lower])
    return `📄 ${bold(documentLabels[lower], markdown)}\n${shortPath(file) || detail || name}`;
  if (lower === 'send_file') return `📎 ${bold('Sending File', markdown)}\n${shortPath(file)}`;
  if (lower === 'ask_user') return `❓ ${bold('Asking User', markdown)}`;
  if (lower === 'todo' || lower === 'planning') {
    const label = lower === 'todo' ? 'Updating Tasks' : 'Planning';
    return `📋 ${bold(label, markdown)}\n${detail || name}`;
  }
  if (lower === 'memory') {
    const action = args.action ? String(args.action) : 'update';
    return `🧠 ${bold('Updating Memory', markdown)}\n${action}`;
  }
  if (lower === 'skill_loader')
    return `📚 ${bold('Loading Skill', markdown)}\n${detail || String(args.skill || args.name || name)}`;
  if (lower === 'system_info')
    return `📊 ${bold('Checking System', markdown)}\nCPU · memory · disk`;
  if (lower === 'docker_manage') {
    const action = args.action ? String(args.action) : 'manage';
    const service = args.container || args.image || args.service || args.name || '';
    return `🐳 ${bold('Managing Docker', markdown)}\n${action}${service ? ` · ${String(service)}` : ''}`;
  }
  if (lower === 'vps') {
    const action = args.action ? String(args.action) : 'manage';
    return `🖧 ${bold('Managing VPS', markdown)}\n${action}${detail ? ` · ${detail}` : ''}`;
  }
  const cloudLabels: Record<string, string> = {
    gcloud_status: 'Checking Google Cloud',
    gcloud_deploy: 'Deploying to Google Cloud',
    aws_status: 'Checking AWS',
    aws_deploy: 'Deploying to AWS',
    cloud_cost: 'Checking Cloud Cost',
  };
  if (cloudLabels[lower]) {
    const project = args.project || args.service || args.region || '';
    return `☁️ ${bold(cloudLabels[lower], markdown)}${project ? `\n${String(project)}` : ''}`;
  }
  const deployLabels: Record<string, string> = {
    deploy_vercel: 'Deploying to Vercel',
    deploy_github_pages: 'Deploying GitHub Pages',
    setup_ci: 'Setting Up CI',
    deploy_status: 'Checking Deploy Status',
  };
  if (deployLabels[lower])
    return `🚀 ${bold(deployLabels[lower], markdown)}${detail ? `\n${detail}` : ''}`;
  const frontendLabels: Record<string, string> = {
    scaffold_project: 'Scaffolding Frontend',
    generate_component: 'Generating Component',
    build_check: 'Checking Frontend Build',
  };
  if (frontendLabels[lower]) {
    const subject = args.component || args.framework || args.project || args.name || detail;
    return `🎨 ${bold(frontendLabels[lower], markdown)}${subject ? `\n${String(subject)}` : ''}`;
  }
  const backendLabels: Record<string, string> = {
    scaffold_api: 'Scaffolding API',
    generate_schema: 'Generating Schema',
    generate_endpoint: 'Generating Endpoint',
    setup_auth: 'Setting Up Auth',
    generate_dockerfile: 'Generating Dockerfile',
  };
  if (backendLabels[lower]) {
    const subject = args.endpoint || args.schema || args.framework || args.name || detail;
    return `🧱 ${bold(backendLabels[lower], markdown)}${subject ? `\n${String(subject)}` : ''}`;
  }
  if (lower === 'evm_wallet') {
    const action = args.action ? String(args.action) : 'wallet';
    return `⛓️ ${bold('EVM Wallet', markdown)}\n${action}${detail ? ` · ${detail}` : ''}`;
  }
  if (lower === 'solana_wallet') {
    const action = args.action ? String(args.action) : 'wallet';
    return `◎ ${bold('Solana Wallet', markdown)}\n${action}${detail ? ` · ${detail}` : ''}`;
  }
  if (lower === 'trading') {
    const symbol = args.symbol || args.pair || args.asset || detail;
    return `📈 ${bold('Trading Analysis', markdown)}${symbol ? `\n${String(symbol)}` : ''}`;
  }
  if (lower === 'maps_lookup')
    return `🗺️ ${bold('Looking Up Maps', markdown)}${detail ? `\n${detail}` : ''}`;
  if (lower === 'music')
    return `🎧 ${bold('Working with Music', markdown)}${detail ? `\n${detail}` : ''}`;
  if (lower === 'setup_notifier')
    return `🔔 ${bold('Setting Up Notifier', markdown)}${detail ? `\n${detail}` : ''}`;
  if (lower === 'humanize_text') return `✨ ${bold('Humanizing Text', markdown)}`;
  if (lower.includes('osint') || lower.includes('cybersec')) {
    const label = lower.includes('osint') ? 'OSINT Investigation' : 'Security Research';
    return `🛡️ ${bold(label, markdown)}\n${detail || name}`;
  }
  if (lower === 'generate_diagram')
    return `🗺️ ${bold('Generating Diagram', markdown)}${detail ? `\n${detail}` : ''}`;
  if (lower === 'gif_search')
    return `🖼️ ${bold('Searching GIFs', markdown)}${query ? `\n${query}` : ''}`;
  if (lower.includes('image') || lower.includes('diagram') || lower.includes('gif'))
    return `🖼️ ${bold('Generating Visual', markdown)}\n${name}`;

  return `🧰 ${bold(name, markdown)}`;
}

export function renderToolEnd(
  input: ToolEventRenderInput,
  options: ToolEventRenderOptions = {}
): string {
  const markdown = options.markdown ?? true;
  const name = input.toolName || 'tool';
  const status = input.status || 'success';
  const icon =
    status === 'success'
      ? '✅'
      : status === 'cancelled'
        ? '⏹️'
        : status === 'timeout'
          ? '⏱️'
          : '❌';
  const label =
    status === 'success'
      ? 'Completed'
      : status === 'cancelled'
        ? 'Cancelled'
        : status === 'timeout'
          ? 'Timed out'
          : 'Failed';
  let text = `${icon} ${bold(`${label}: ${name}`, markdown)}${statusSuffix(input)}`;
  if (options.includeResultPreview && input.data) {
    const preview = truncateLines(
      input.data,
      options.maxLines || 8,
      options.maxLineLength || 140
    ).trim();
    if (preview) text += `\n${preview}`;
  }
  return text;
}

export function renderToolSpinnerText(input: ToolEventRenderInput): string {
  const label = renderToolStart(input, { markdown: false, maxLines: 1, maxLineLength: 80 })
    .replace(/\n+/g, ' · ')
    .replace(/```/g, '')
    .trim();
  return label || `Using ${input.toolName || 'tool'}`;
}
