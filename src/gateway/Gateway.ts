import { AskUserManager } from '../tools/AskUser.js';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import type { AurixConfig } from '../agent/Config.js';
import { loadConfig, saveConfig } from '../agent/Config.js';
import { AgentLoop } from '../agent/AgentLoop.js';
import type { ToolRegistry } from '../tools/Registry.js';

function cryptoRandomId(): string {
  return crypto.randomBytes(6).toString('hex');
}

// Convert markdown to plain text for chat platforms (Telegram/Discord/WA)
// Strips all markdown formatting: bold, headers, code blocks, backticks, etc.
function stripMarkdown(text: string): string {
  return text
    // Remove code blocks (```...```)
    .replace(/```[\s\S]*?```/g, (match) => {
      // Extract code content without the fences
      return match.replace(/^```[a-z]*\n?/g, '').replace(/```$/g, '').trim();
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
    .trim();
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
  send(content: string, channelId: string, replyTo?: string): Promise<void>;
  sendFile?(filePath: string, channelId: string, caption?: string, replyTo?: string): Promise<void>;
  edit?(content: string, channelId: string, messageId: string): Promise<void>;
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
  /queue <text> — Queue a message
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

function formatToolStatus(toolName: string, args?: Record<string, unknown>): string {
  if (toolName === 'research_forums') {
    const sources = args?.sources
      ? String(args.sources).split(',').map(s => SOURCE_LABELS[s.trim().toLowerCase()] || s.trim())
      : ['Reddit', 'X/Twitter', 'YouTube', 'Hacker News', 'GitHub', 'Web'];
    return `❄️ using_tools: research_forums (${sources.join(', ')})`;
  }

  if (toolName === 'research') {
    const depth = args?.depth ? String(args.depth) : 'standard';
    const query = args?.query ? String(args.query).slice(0, 60) : '';
    return `❄️ using_tools: research "${query}" (${depth})`;
  }

  if (toolName === 'web_search') {
    const query = args?.query ? String(args.query).slice(0, 60) : '';
    return `❄️ using_tools: web_search "${query}"`;
  }

  if (toolName === 'terminal' || toolName === 'bash') {
    const cmd = args?.command ? String(args.command).slice(0, 100) : '';
    return `❄️ using_tools: ${cmd}`;
  }

  if (toolName === 'browser') {
    const action = args?.action ? String(args.action) : '';
    const target = args?.target ? ` → ${String(args.target).slice(0, 40)}` : '';
    const value = args?.value ? ` "${String(args.value).slice(0, 30)}"` : '';
    return `❄️ using_tools: browser ${action}${target}${value}`;
  }

  if (toolName === 'read_file') {
    const file = args?.file_path || args?.path ? String(args.file_path || args.path) : '';
    const shortFile = String(file).split('/').pop() || file;
    return `❄️ using_tools: read ${shortFile}`;
  }

  if (toolName === 'write_file') {
    const file = args?.file_path || args?.path ? String(args.file_path || args.path) : '';
    const shortFile = String(file).split('/').pop() || file;
    return `❄️ using_tools: write ${shortFile}`;
  }

  if (toolName === 'file_edit') {
    const file = args?.file_path || args?.path ? String(args.file_path || args.path) : '';
    const shortFile = String(file).split('/').pop() || file;
    return `❄️ using_tools: edit ${shortFile}`;
  }

  if (toolName === 'search_files') {
    const pattern = args?.pattern ? String(args.pattern).slice(0, 40) : '';
    const path = args?.path ? ` in ${String(args.path)}` : '';
    return `❄️ using_tools: search "${pattern}"${path}`;
  }

  return `❄️ using_tools: ${toolName}`;
}

function cleanResponse(text: string): string {
  return text
    .replace(/\$([^\s$][^$\n]*[^\s$])\$/g, '')
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
  private lastContext = new Map<string, { platform: string; channelId: string; replyTo?: string }>();
  private sessionNames = new Map<string, string>();
  private messageQueue = new Map<string, IncomingMessage>();

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
        return { cmd: (parts[0] || '').toLowerCase(), args: parts.slice(1).join(' ') };
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

    if (AskUserManager.isWaiting(agentKey)) {
      AskUserManager.submitAnswer(agentKey, msg.content.trim());
      return;
    }

    this.lastContext.set(agentKey, {
      platform: msg.platform,
      channelId: msg.channelId,
      replyTo: msg.replyTo,
    });

    const text = msg.content.trim();
    const isWA = this.isWhatsApp(msg);
    const { cmd, args } = this.normalizeCommand(text, msg.platform);

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

    if (!this.isUserAllowed(msg)) {
      await platform.send('🔒 Access denied. Your user ID is not in the allowed list for this bot.', msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'proxy') {
      const proxyRegex = /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}(:[^:\s]+:[^:\s]+)?$/;
      const proxyLines = args.split(/[\s\n]+/).map(l => l.trim()).filter(l => proxyRegex.test(l));
      if (proxyLines.length === 0) {
        await platform.send('🌐 Usage: /proxy <ip:port:user:pass>\nPaste one or more proxies (one per line).', msg.channelId, msg.replyTo);
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
          await platform.send(`🌐 ${added} proxy added (total: ${config.browser.proxies.length}).`, msg.channelId, msg.replyTo);
        } else {
          await platform.send(`🌐 All proxies already exist (total: ${config.browser.proxies!.length}).`, msg.channelId, msg.replyTo);
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
          await platform.send(`❄️ Agent is working...\nTokens used: ${totalTokens}`, msg.channelId, msg.replyTo);
        } else {
          await platform.send('❄️ No active task. Use /btw <text> to inject context.', msg.channelId, msg.replyTo);
        }
        return;
      }

      if (isActive) {
        agent.injectContext(`[User added context while you were working]: ${btwText}`);
        await platform.send(`❄️ Context injected into current task.`, msg.channelId, msg.replyTo);
      } else {
        await platform.send(`❄️ No active task. Sending as new message...`, msg.channelId, msg.replyTo);
        msg.content = btwText;
        setImmediate(() => this.handleMessage(msg));
      }
      return;
    }

    if (this.activeProcessing.has(agentKey)) {
      this.messageQueue.set(agentKey, msg);
      await platform.send(stripMarkdown('📋 Task queued. Current task still running — your message will be processed after it finishes.\nUse /cancel to stop the current task.'), msg.channelId, msg.replyTo);
      return;
    }

    this.emit('message', msg);

    if (isWA && !text.toLowerCase().startsWith('!ai')) {
      return;
    }

    if (cmd === 'start') {
      await platform.send(stripMarkdown(isWA ? WA_COMMAND_GUIDE : COMMAND_GUIDE), msg.channelId, msg.replyTo);
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
      await platform.send(stripMarkdown(isWA ? WA_MINI_GUIDE : MINI_GUIDE), msg.channelId, msg.replyTo);
    }

    if (cmd === 'reset') {
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
      const masked = args.slice(0, 8) + '...' + args.slice(-4);
      console.log(`[Gateway] API key updated`);
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
        `  ✻ ${t.name} — ${t.description.slice(0, 50)}`
      ).join('\n');
      await platform.send(stripMarkdown(`✻ Available tools (${tools.length}):\n${toolList}`), msg.channelId, msg.replyTo);
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
      const name = this.sessionNames.get(agentKey);
      const sessionId = agent.saveSession(name);
      if (name) {
        await platform.send(`✅ Session saved as "${name}"!\nResume with: /resume ${name}`, msg.channelId, msg.replyTo);
      } else {
        await platform.send(`✅ Session saved!\nName it with: /title <name>\nResume with: /resume ${sessionId}`, msg.channelId, msg.replyTo);
      }
      return;
    }

    if (cmd === 'title') {
      const agent = this.getAgent(agentKey);
      let name = args.trim();
      if (!name) {
        name = 's-' + cryptoRandomId();
      }
      name = name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 40);
      this.sessionNames.set(agentKey, name);
      agent.saveSession(name);
      await platform.send(`💾 Session named: "${name}"\nAuto-saved. Resume anytime: /resume ${name}`, msg.channelId, msg.replyTo);
      return;
    }

    if (cmd === 'resume') {
      let name = args.trim();
      if (!name) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const os = await import('os');
          const sessionsDir = path.join(os.homedir(), '.aurix', 'memories', 'sessions');
          if (fs.existsSync(sessionsDir)) {
            const files = fs.readdirSync(sessionsDir)
              .filter(f => f.endsWith('.json'))
              .map(f => {
                const stat = fs.statSync(path.join(sessionsDir, f));
                return { name: f.replace('.json', ''), time: stat.mtimeMs };
              })
              .sort((a, b) => b.time - a.time)
              .slice(0, 10);
            if (files.length === 0) {
              await platform.send('No saved sessions found. Use /title <name> to create one.', msg.channelId, msg.replyTo);
              return;
            }
            const list = files.map((f, i) => `  ${i + 1}. ${f.name}`).join('\n');
            await platform.send(`💾 Saved sessions:\n${list}\n\nResume with: /resume <name>`, msg.channelId, msg.replyTo);
            return;
          }
        } catch {}
        await platform.send('No saved sessions found. Use /title <name> to create one.', msg.channelId, msg.replyTo);
        return;
      }

      this.agents.delete(agentKey);
      const agent = this.getAgent(agentKey);
      const count = agent.loadSession(name);
      if (count > 0) {
        this.sessionNames.set(agentKey, name);
        await platform.send(`✅ Session "${name}" loaded (${count} messages).\nContinuing where you left off.`, msg.channelId, msg.replyTo);
      } else {
        await platform.send(`❌ Session "${name}" not found.\nUse /resume (no args) to list available sessions.`, msg.channelId, msg.replyTo);
      }
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
    if (!userPrompt) return;
    console.log(`[Gateway] Processing message from ${msg.platform} user=${msg.authorId}: "${userPrompt.slice(0, 80)}"`);

    const platformTag = `[sent from ${msg.platform}]`;
    const forwardTag = msg.forwardedFrom ? ` [forwarded from ${msg.forwardedFrom}]` : '';
    const imagePaths: string[] = [];
    const attachTag = msg.attachments?.length
      ? ' ' + msg.attachments.map(a => {
          if (a.url && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(a.url)) {
            imagePaths.push(a.url);
          }
          return `[image: ${a.filename || a.url || 'attached'}]`;
        }).join(' ')
      : '';
    const taggedPrompt = `${platformTag}${forwardTag}${attachTag} ${userPrompt}`;

    const agent = this.getAgent(agentKey);
    this.activeProcessing.add(agentKey);

    try {
      let fullResponse = '';
      let lastStatusUpdate = Date.now();
      let lastToolStatus = '';

      // Send thinking indicator
      await platform.send('❄️ Thinking...', msg.channelId, msg.replyTo);

      for await (const event of agent.run(taggedPrompt, imagePaths.length > 0 ? imagePaths : undefined)) {
        if (event.type === 'tool_start') {
          const toolName = event.toolName || event.data;
          const args = event.toolArgs;
          let snippet = '';
          if (args) {
            if (args.command) snippet = String(args.command).slice(0, 200);
            else if (args.file_path || args.path) snippet = String(args.file_path || args.path).slice(0, 200);
            else if (args.query) snippet = String(args.query).slice(0, 200);
            else if (args.url) snippet = String(args.url).slice(0, 200);
            else snippet = JSON.stringify(args).slice(0, 200);
          }
          const newStatus = `❄️ ${toolName}${snippet ? ': ' + snippet : ''}`;
          if (newStatus !== lastToolStatus) {
            await platform.send(newStatus, msg.channelId, msg.replyTo);
            lastToolStatus = newStatus;
            lastStatusUpdate = Date.now();
          }
        } else if (event.type === 'text') {
          fullResponse += event.data;
        } else if (event.type === 'error') {
          await platform.send(`❌ ${event.data}`, msg.channelId, msg.replyTo);
        } else if (event.type === 'compact') {
          await platform.send(`📦 ${event.data}`, msg.channelId, msg.replyTo);
        }
      }

      if (fullResponse) {
        const cleaned = stripMarkdown(cleanResponse(fullResponse));
        const maxLen = platform.name === 'discord' ? 1900 : 4000;
        const chunks = splitMessage(cleaned, maxLen);
        for (const chunk of chunks) {
          await platform.send(chunk, msg.channelId, msg.replyTo);
        }
      } else {
        console.error('[Gateway] Agent produced no response');
        await platform.send('❄️ Agent produced no response. Try again or use /reset.', msg.channelId, msg.replyTo);
      }
    } catch (e: any) {
      console.error(`[Gateway] Error processing message: ${e.message}`);
      console.error(e.stack);
      await platform.send(`❌ Error: ${e.message}`, msg.channelId, msg.replyTo);
    } finally {
      this.activeProcessing.delete(agentKey);
    }

    this.emit('response', { msg, response: 'sent' });

    const queued = this.messageQueue.get(agentKey);
    if (queued) {
      this.messageQueue.delete(agentKey);
      await platform.send('▶️ Processing queued message...', queued.channelId, queued.replyTo);
      setImmediate(() => this.handleMessage(queued));
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

  getLastContext(userKey: string): { platform: string; channelId: string; replyTo?: string } | undefined {
    return this.lastContext.get(userKey);
  }

  getMostRecentContext(): { userKey: string; platform: string; channelId: string; replyTo?: string } | null {
    let latest: { userKey: string; platform: string; channelId: string; replyTo?: string } | null = null;
    for (const [userKey, ctx] of this.lastContext) {
      latest = { userKey, ...ctx };
    }
    return latest;
  }

  getAllContexts(): Array<{ userKey: string; platform: string; channelId: string; replyTo?: string }> {
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
    if (!ctx) return 'No active conversation context found. The user needs to send a message first.';

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
