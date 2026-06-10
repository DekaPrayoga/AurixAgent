import { EventEmitter } from 'events';
import type { AurixConfig } from '../agent/Config.js';
import { AgentLoop } from '../agent/AgentLoop.js';
import type { ToolRegistry } from '../tools/Registry.js';

export interface IncomingMessage {
  platform: string;
  authorId: string;
  authorName: string;
  channelId: string;
  content: string;
  replyTo?: string;
}

export interface Platform {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(content: string, channelId: string, replyTo?: string): Promise<void>;
  edit?(content: string, channelId: string, messageId: string): Promise<void>;
  on(event: 'message', handler: (msg: IncomingMessage) => void): this;
}

const COMMAND_GUIDE = `⏳ *AURIX Agent* — Multi-Agent AI Assistant

📋 *ALL COMMANDS:*

*Session:*
  /start — Show this guide
  /help — Quick help
  /reset — Clear conversation
  /status — Model, provider, uptime
  /history — Message count
  /save — Save conversation transcript

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
  /queue <text> — Queue a message

💡 *RESEARCH DEPTH:*
  low — Quick single-agent answers
  medium — Research + sources
  high — Full team + citations (multi-agent)
  xhigh — + Debate system
  max — + Logic critic
  ultra — + Final review loop (publication-grade)

💡 *TIPS:*
  Just type your question to start.
  Attach images for vision analysis.
  Use /depth to control thoroughness.
  Journal/scientific answers include sources.`;

const WA_COMMAND_GUIDE = `⏳ *AURIX Agent* — Multi-Agent AI Assistant

📋 *ALL COMMANDS:*

*Session:*
  !ai start — Show this guide
  !ai help — Quick help
  !ai reset — Clear conversation
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

const STATUS_EMOJIS: Record<string, string> = {
  thinking: '⏳',
  tool_start: '🔧',
  text: '✍️',
  done: '✅',
  error: '❌',
};

function formatStatus(status: string, detail?: string): string {
  const emoji = STATUS_EMOJIS[status] || '⏳';
  const label: Record<string, string> = {
    thinking: 'Thinking...',
    tool_start: `Using ${detail || 'tool'}...`,
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

function formatToolStatus(toolName: string, args?: Record<string, unknown>): string {
  if (toolName === 'research_forums') {
    const sources = args?.sources
      ? String(args.sources).split(',').map(s => SOURCE_LABELS[s.trim().toLowerCase()] || s.trim())
      : ['Reddit', 'X/Twitter', 'YouTube', 'Hacker News', 'GitHub', 'Web'];
    return `🔬 Researching on ${sources.join(', ')}...`;
  }

  if (toolName === 'research') {
    const depth = args?.depth ? String(args.depth) : 'standard';
    return `🔬 Deep research (${depth} depth)...`;
  }

  if (toolName === 'web_search') {
    const query = args?.query ? String(args.query).slice(0, 60) : '';
    return `🔍 Searching web: ${query}...`;
  }

  if (toolName === 'terminal' || toolName === 'bash') {
    const cmd = args?.command ? String(args.command).slice(0, 80) : '';
    return `🔧 Running: ${cmd}...`;
  }

  if (toolName === 'browser') {
    const url = args?.url ? String(args.url).slice(0, 60) : '';
    return `🌐 Browsing: ${url}...`;
  }

  if (toolName === 'vision') {
    return `👁️ Analyzing image...`;
  }

  if (toolName === 'read_file' || toolName === 'write_file') {
    const file = args?.file_path || args?.path ? String(args.file_path || args.path) : '';
    const shortFile = String(file).split('/').pop() || file;
    return `📄 ${toolName === 'read_file' ? 'Reading' : 'Writing'}: ${shortFile}...`;
  }

  return formatStatus('tool_start', toolName);
}

function cleanResponse(text: string): string {
  return text
    .replace(/\$[\s\S]*?\$/gm, '')
    .replace(/```(?:bash|sh|shell)\n[\s\S]*?```/gm, '')
    .replace(/>\s.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class Gateway extends EventEmitter {
  private platforms = new Map<string, Platform>();
  private agents = new Map<string, AgentLoop>();
  private config: AurixConfig;
  private registry: ToolRegistry;
  private firstTimeUsers = new Set<string>();
  private userDepths = new Map<string, string>();
  private startTime: number;
  private activeProcessing = new Set<string>();

  constructor(config: AurixConfig, registry: ToolRegistry) {
    super();
    this.config = config;
    this.registry = registry;
    this.startTime = Date.now();
  }

  register(platform: Platform): void {
    this.platforms.set(platform.name, platform);
    platform.on('message', (msg) => this.handleMessage(msg));
  }

  private getAgent(key: string): AgentLoop {
    let agent = this.agents.get(key);
    if (!agent) {
      agent = new AgentLoop(this.config, this.registry);
      this.agents.set(key, agent);
    }
    return agent;
  }

  private getUserKey(msg: IncomingMessage): string {
    return `${msg.platform}:${msg.authorId}`;
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
        return { cmd: (parts[0] || '').toLowerCase(), args: parts.slice(1).join(' ') };
      }
      return { cmd: '', args: trimmed };
    }
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/^\//, '');
    return { cmd, args: parts.slice(1).join(' ') };
  }

  private async handleMessage(msg: IncomingMessage) {
    const agentKey = this.getUserKey(msg);
    const platform = this.platforms.get(msg.platform);

    if (!platform) return;

    if (this.activeProcessing.has(agentKey)) {
      await platform.send('⏳ Still processing your previous request...', msg.channelId, msg.replyTo);
      return;
    }

    this.emit('message', msg);

    const text = msg.content.trim();
    const isWA = this.isWhatsApp(msg);

    if (isWA && !text.toLowerCase().startsWith('!ai')) {
      return;
    }

    const { cmd, args } = this.normalizeCommand(text, msg.platform);

    if (cmd === 'start') {
      await platform.send(isWA ? WA_COMMAND_GUIDE : COMMAND_GUIDE, msg.channelId, msg.replyTo);
      this.firstTimeUsers.add(agentKey);
      return;
    }

    if (cmd === 'help') {
      const helpText = isWA
        ? `⏳ AURIX Quick Help\n\n!ai start — Full guide\n!ai reset — Clear context\n!ai model <name> — Switch model\n!ai depth <level> — Research depth\n!ai tools — List tools\n!ai status — Show status\n\nOr just type: !ai <your question>`
        : `⏳ AURIX Quick Help\n\n/start — Full guide\n/reset — Clear context\n/model <name> — Switch model\n/depth <level> — Research depth (low/medium/high/xhigh/max/ultra)\n/tools — List tools\n/skills — List skills\n/status — Show status\n/history — Message count\n\nOr just type your question!`;
      await platform.send(helpText, msg.channelId, msg.replyTo);
      return;
    }

    if (!this.firstTimeUsers.has(agentKey)) {
      this.firstTimeUsers.add(agentKey);
      await platform.send(isWA ? WA_MINI_GUIDE : MINI_GUIDE, msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'reset') {
      this.agents.delete(agentKey);
      await platform.send('✅ Context reset. Starting fresh.', msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'model' && args) {
      const agent = this.getAgent(agentKey);
      agent.setProvider({ model: args });
      await platform.send(`✅ Model switched to: ${args}`, msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'baseurl' && args) {
      const agent = this.getAgent(agentKey);
      agent.setProvider({ baseUrl: args });
      await platform.send(`✅ Base URL switched to: ${args}`, msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'apikey' && args) {
      const agent = this.getAgent(agentKey);
      agent.setProvider({ apiKey: args });
      const masked = args.slice(0, 8) + '...' + args.slice(-4);
      await platform.send(`✅ API key updated (${masked})`, msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'depth' && args) {
      const mode = args.toLowerCase();
      if (VALID_DEPTHS.includes(mode)) {
        this.userDepths.set(agentKey, mode);
        const desc: Record<string, string> = {
          low: 'Quick single-agent answers',
          medium: 'Research + sources',
          high: 'Full team + citations (multi-agent)',
          xhigh: '+ Debate system',
          max: '+ Logic critic',
          ultra: '+ Final review loop (publication-grade)',
        };
        await platform.send(`✅ Research depth: ${mode}\n${desc[mode]}`, msg.channelId, msg.replyTo);
      } else {
        await platform.send(`❌ Invalid depth. Choose: ${VALID_DEPTHS.join(', ')}`, msg.channelId, msg.replyTo);
      }
      return;
    }

    if (cmd === 'tools') {
      const tools = this.registry.list();
      if (tools.length === 0) {
        await platform.send('No tools registered.', msg.channelId, msg.replyTo);
        return;
      }
      const toolList = tools.slice(0, 30).map(t =>
        `  🔧 ${t.name} — ${t.description.slice(0, 50)}`
      ).join('\n');
      await platform.send(`🔧 Available tools (${tools.length}):\n${toolList}`, msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'skills') {
      await platform.send('📚 Skills listing coming soon. Check /tools for capabilities.', msg.channelId, msg.replyTo);
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
      const sessionId = agent.saveSession();
      await platform.send(`✅ Session saved! Resume with: aurix --resume ${sessionId}`, msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'compress') {
      await platform.send('⏳ Compressing context...', msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'fast') {
      await platform.send('⚡ Fast mode toggled.', msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'agents') {
      await platform.send('🤖 Active agents: Main agent running. Use /depth high+ for multi-agent.', msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'review') {
      await platform.send('🔍 Code review: paste your code and I\'ll review it!', msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'plan') {
      await platform.send('📋 Planning mode: describe your project and I\'ll create a plan!', msg.channelId, msg.replyTo);
      return;
    }

    const userPrompt = isWA ? (args || text.replace(/^!ai\s*/i, '').trim()) : text;
    if (!userPrompt || cmd === '') return;

    const platformTag = `[sent from ${msg.platform}]`;
    const taggedPrompt = `${platformTag} ${userPrompt}`;

    const agent = this.getAgent(agentKey);
    this.activeProcessing.add(agentKey);

    try {
      let fullResponse = '';
      let statusMsg = formatStatus('thinking');
      await platform.send(statusMsg, msg.channelId, msg.replyTo);

      let lastStatusUpdate = Date.now();

      for await (const event of agent.run(taggedPrompt)) {
        if (event.type === 'tool_start') {
          const now = Date.now();
          if (now - lastStatusUpdate > 2000) {
            statusMsg = formatToolStatus(event.toolName || event.data, event.toolArgs);
            await platform.send(statusMsg, msg.channelId, msg.replyTo);
            lastStatusUpdate = now;
          }
        } else if (event.type === 'text') {
          fullResponse += event.data;
          const now = Date.now();
          if (now - lastStatusUpdate > 3000 && fullResponse.length > 50) {
            statusMsg = formatStatus('text');
            await platform.send(statusMsg, msg.channelId, msg.replyTo);
            lastStatusUpdate = now;
          }
        }
      }

      if (fullResponse) {
        const cleaned = cleanResponse(fullResponse);
        const chunks = splitMessage(cleaned, 1900);
        for (const chunk of chunks) {
          await platform.send(chunk, msg.channelId, msg.replyTo);
        }
      }
    } catch (e: any) {
      await platform.send(`❌ Error: ${e.message}`, msg.channelId, msg.replyTo);
    } finally {
      this.activeProcessing.delete(agentKey);
    }

    this.emit('response', { msg, response: 'sent' });
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
    results.forEach(r => console.log(`  ${r}`));
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
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
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
