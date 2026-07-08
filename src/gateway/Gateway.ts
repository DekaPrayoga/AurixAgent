import { AskUserManager, setGlobalAskCallback } from '../tools/AskUser.js';
import { EventEmitter } from 'events';
import fs from 'fs';
import crypto from 'crypto';
import type { AurixConfig } from '../agent/Config.js';
import { loadConfig, saveConfig } from '../agent/Config.js';
import { AgentLoop } from '../agent/AgentLoop.js';
import { MemoryEngine } from '../agent/MemoryEngine.js';
import { renderToolEnd, renderToolStart } from '../agent/ToolEventRenderer.js';
import { CronDaemon } from '../agent/CronDaemon.js';
import { getSessionStore } from '../agent/SessionStore.js';
import type { ToolRegistry } from '../tools/Registry.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';
import { formatStructuredOutput } from '../utils/StructuredOutputFormat.js';

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
  /history-search <query> — Search durable sessions
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
  /agents — Show active agents/jobs
  /cron — Manage scheduled automations
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
  !ai history-search <query> — Search durable sessions

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
  'history-search',
  'model',
  'baseurl',
  'apikey',
  'depth',
  'fast',
  'tools',
  'skills',
  'review',
  'code-review',
  'security-review',
  'diff',
  'verify',
  'plan',
  'research',
  'research-forums',
  'summarize',
  'pdf',
  'pptx',
  'xlsx',
  'deep',
  'deep-research',
  'compress',
  'agents',
  'sessions',
  'new',
  'usage',
  'insights',
  'evals',
  'replay',
  'trash',
  'whoami',
  'cost',
  'doctor',
  'permissions',
  'yolo',
  'cron',
  'btw',
  'proxy',
  'login',
]);

function cleanResponse(text: string): string {
  return safeDisplayText(text)
    .replace(/\$(?!\d)([^\s$][^$\n]*[^\s$])\$/g, '')
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
  const cleaned = formatStructuredOutput(cleanResponse(text), 'gateway');
  if (platformName === 'telegram') {
    return {
      text: markdownToTelegramHtml(cleaned),
      options: { parse_mode: 'HTML', disable_web_page_preview: true },
    };
  }
  return { text: stripMarkdown(cleaned) };
}

function gatewayPlainText(text: string): string {
  return stripMarkdown(formatStructuredOutput(cleanResponse(text), 'gateway'));
}

function looksLikeMarkdownTable(text: string): boolean {
  const lines = stripMarkdown(text).split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i].trim();
    const divider = lines[i + 1].trim();
    if (!header.includes('|') || !divider.includes('|')) continue;
    const dividerCells = divider
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    if (dividerCells.length >= 2 && dividerCells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      return true;
    }
  }
  return false;
}

function isProgressPlatform(platform: Platform): boolean {
  // Keep every progress/tool event as its own chat message. Editing a single
  // status message hides the command/tool timeline from gateway users.
  return false;
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
  private pendingOptionValues = new Map<string, Map<string, string>>();
  private cronDaemon: CronDaemon;

  constructor(config: AurixConfig, registry: ToolRegistry, cronDaemon?: CronDaemon) {
    super();
    this.config = config;
    this.registry = registry;
    this.startTime = Date.now();
    this.cronDaemon = cronDaemon || new CronDaemon(registry);
    this.cronDaemon.setDelivery(async (job, result) => {
      const platform = job.targetPlatform ? this.platforms.get(job.targetPlatform) : undefined;
      if (platform && job.targetChannelId) {
        const rendered = gatewayText(result, platform.name);
        const maxLen =
          platform.name === 'discord'
            ? 1900
            : platform.name === 'telegram' && looksLikeMarkdownTable(rendered.text)
              ? 32000
              : 4000;
        for (const chunk of splitMessage(rendered.text, maxLen)) {
          await platform.send(chunk, job.targetChannelId, job.targetReplyTo, rendered.options);
        }
      }
    });
    if (!cronDaemon) this.cronDaemon.start().catch(() => {});

    const notifyAskUser = (sessionKey: string, question: string, toolOptions?: string[]) => {
      const ctx =
        this.lastContext.get(sessionKey) ||
        (sessionKey === 'default' ? this.lastContext.get('default') : undefined) ||
        this.getMostRecentContext();
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
              const optionMap = new Map<string, string>();
              const keyboard = [
                ...toolOptions.slice(0, 8).map((opt, idx) => {
                  const token = `__aurix_opt_${idx}__`;
                  optionMap.set(token, opt);
                  return [
                    {
                      text: opt.length > 48 ? `${opt.slice(0, 45)}...` : opt,
                      callback_data: token,
                    },
                  ];
                }),
                [{ text: '✍️ Type Your Answer', callback_data: '__aurix_type_answer__' }],
              ];
              this.pendingOptionValues.set(sessionKey, optionMap);
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
    };

    this.registry.setPermissionHandler(async (request) => {
      let sessionKey = String(request.arguments._sessionKey || 'default');
      const recentContext = this.getMostRecentContext();
      if ((sessionKey === 'default' || !this.lastContext.has(sessionKey)) && recentContext) {
        sessionKey = recentContext.userKey;
      }
      const destructive =
        request.toolName === 'delete_file' || request.toolName === 'delete_folder';
      const dependencyInstall = Boolean(request.arguments.dependencyInstall);
      if (!this.lastContext.has(sessionKey)) {
        console.warn(
          `[Gateway] Denying ${request.toolName}: no gateway context for permission prompt (${sessionKey})`
        );
        return 'deny';
      }
      const answer = await AskUserManager.ask(
        sessionKey,
        destructive
          ? `Destructive action requested:\n${request.toolName}\n${request.summary}\n\nReply allow to approve or deny to cancel.`
          : dependencyInstall
            ? `Dependency install requested:\n${request.summary}\n\nReply allow to run this install command or deny to cancel.`
            : `Tool permission requested:\n${request.toolName} [${request.risk}]\n${request.summary}\n\nReply allow to approve once or deny to cancel.`,
        ['deny', 'allow'],
        (question, options) => notifyAskUser(sessionKey, question, options)
      );
      return /^(allow|yes|y)$/i.test(answer.trim()) ? 'once' : 'deny';
    });

    setGlobalAskCallback(notifyAskUser);
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
        const canonical = KNOWN_COMMANDS.has(first) ? first : first.replace(/_/g, '-');
        if (!first || !KNOWN_COMMANDS.has(canonical)) return { cmd: '', args: rest };
        return { cmd: canonical, args: parts.slice(1).join(' ') };
      }
      return { cmd: '', args: trimmed };
    }
    const parts = trimmed.split(/\s+/);
    if (parts[0].startsWith('/')) {
      const raw = parts[0].toLowerCase().slice(1).split('@')[0];
      const cmd = KNOWN_COMMANDS.has(raw) ? raw : raw.replace(/_/g, '-');
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

    // Allow /btw, /cancel, and pending approval/ask replies through while agent is processing.
    if (cmd !== 'btw' && cmd !== 'cancel' && !AskUserManager.isWaiting(agentKey)) {
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
        const rawAnswer = msg.content.trim();
        const mappedAnswer = this.pendingOptionValues.get(agentKey)?.get(rawAnswer) || rawAnswer;
        if (rawAnswer !== '__aurix_type_answer__') this.pendingOptionValues.delete(agentKey);
        AskUserManager.submitAnswer(agentKey, mappedAnswer);
        return;
      }

      const currentContext = {
        platform: msg.platform,
        channelId: msg.channelId,
        replyTo: msg.replyTo,
      };
      this.lastContext.set(agentKey, currentContext);
      this.lastContext.set('default', currentContext);

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
        await platform.send(
          `📝 ${count} messages in conversation.\nDurable session: ${agent.getSessionId()}`,
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'history-search') {
        const query = args.trim();
        if (!query) {
          await platform.send(
            'Usage: /history-search <query>\nExample: /history-search geetest',
            msg.channelId,
            msg.replyTo
          );
          return;
        }
        const agent = this.getAgent(agentKey);
        try {
          const hits = await agent.searchSessions(query, 8);
          if (hits.length === 0) {
            await platform.send(
              `No durable session hits for: ${query}`,
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          const list = hits
            .map(
              (s, i) =>
                `  ${i + 1}. ${s.id} — ${s.preview || s.snippet || '(empty)'} (${s.messageCount} msg)`
            )
            .join('\n');
          await platform.send(
            `🔎 History search: "${query}"\n${list}\n\nResume newest match: /resume latest ${query}`,
            msg.channelId,
            msg.replyTo
          );
        } catch (e: any) {
          await platform.send(`History search failed: ${e.message}`, msg.channelId, msg.replyTo);
        }
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
        const listingAgent = this.getAgent(agentKey);
        if (!name) {
          const sessions = await listingAgent.listDurableSessions(10);
          if (sessions.length === 0) {
            const memory = new MemoryEngine();
            const legacy = memory.listSessions().slice(0, 10);
            if (legacy.length === 0) {
              await platform.send(
                'No saved CLI/gateway sessions found. Use /title <name> or send a message to create durable history.',
                msg.channelId,
                msg.replyTo
              );
              return;
            }
            const list = legacy
              .map((s, i) => `  ${i + 1}. ${s.id} — ${s.preview} (${s.messageCount} msg)`)
              .join('\n');
            await platform.send(
              `💾 Legacy AURIX sessions:\n${list}\n\nResume any session with: /resume <id>`,
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          const list = sessions
            .map((s, i) => `  ${i + 1}. ${s.id} — ${s.preview} (${s.messageCount} msg)`)
            .join('\n');
          await platform.send(
            `💾 Shared durable AURIX sessions:\n${list}\n\nResume newest match: /resume latest <query>\nResume exact: /resume <id>`,
            msg.channelId,
            msg.replyTo
          );
          return;
        }

        if (name.toLowerCase().startsWith('latest')) {
          const query = name.slice('latest'.length).trim();
          const latest = await listingAgent.findLatestSession(query || undefined);
          if (!latest) {
            await platform.send(
              query ? `❌ No session matches: ${query}` : '❌ No durable sessions found.',
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          name = latest.id;
        }

        this.agents.get(agentKey)?.interrupt();
        this.activeProcessing.delete(agentKey);
        this.messageQueue.delete(agentKey);
        this.agents.delete(agentKey);
        const agent = this.getAgent(agentKey);
        const count = await agent.loadSessionAsync(name);
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
        try {
          const store = await getSessionStore();
          const jobs = store.listAgentJobs(8);
          if (jobs.length === 0) {
            await platform.send(
              '🤖 No persisted agent jobs yet. Native specialists are selected per task when /depth high+ or multi-agent routing applies.',
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          const lines = jobs.map((j, i) => {
            const count = j.totalAgents ? ` ${j.completedAgents || 0}/${j.totalAgents}` : '';
            const state = j.finishedAt ? `finished ${j.finishedAt}` : 'running';
            return `${i + 1}. ${j.id} ${j.status}${count} — ${state}${j.lastStatus ? ` — ${j.lastStatus}` : ''}\n   ${j.prompt.replace(/\s+/g, ' ').slice(0, 100)}`;
          });
          await platform.send(`🤖 Agent jobs\n\n${lines.join('\n')}`, msg.channelId, msg.replyTo);
        } catch (e: any) {
          await platform.send(`Agent dashboard failed: ${e.message}`, msg.channelId, msg.replyTo);
        }
        return;
      }

      if (cmd === 'sessions') {
        try {
          const agent = this.getAgent(agentKey);
          const sessions = await agent.listDurableSessions(10);
          if (sessions.length === 0) {
            await platform.send(
              'No durable sessions found. Use /title <name> or send a message first.',
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          const lines = sessions.map(
            (s, i) => `${i + 1}. ${s.id} — ${s.preview || '(empty)'} (${s.messageCount} msg)`
          );
          await platform.send(
            `💾 Sessions\n\n${lines.join('\n')}\n\nResume: /resume <id> or /resume latest <query>`,
            msg.channelId,
            msg.replyTo
          );
        } catch (e: any) {
          await platform.send(`Sessions failed: ${e.message}`, msg.channelId, msg.replyTo);
        }
        return;
      }

      if (cmd === 'new') {
        this.agents.get(agentKey)?.interrupt();
        this.activeProcessing.delete(agentKey);
        this.messageQueue.delete(agentKey);
        this.agents.delete(agentKey);
        await platform.send('🆕 New session started. Context reset.', msg.channelId, msg.replyTo);
        return;
      }

      if (cmd === 'usage') {
        const agent = this.getAgent(agentKey);
        const subcmd = args.trim().toLowerCase();
        if (subcmd === 'tools') {
          try {
            const stats = await agent.getToolUsageStats(12);
            if (stats.length === 0) {
              await platform.send('No tool usage stats recorded yet.', msg.channelId, msg.replyTo);
              return;
            }
            const lines = stats.map(
              (s, i) =>
                `${i + 1}. ${s.toolName}: ${s.total} runs, ${s.successRate}% success (${s.success}/${s.total})${s.averageDurationMs ? `, avg ${s.averageDurationMs}ms` : ''}${s.topErrorType ? `, top error: ${s.topErrorType}` : ''}`
            );
            await platform.send(`📊 Tool usage\n\n${lines.join('\n')}`, msg.channelId, msg.replyTo);
          } catch (e: any) {
            await platform.send(`Tool usage failed: ${e.message}`, msg.channelId, msg.replyTo);
          }
          return;
        }
        const stats = agent.getContextStats();
        const tokens = agent.getTokenStats();
        await platform.send(
          `📊 Usage\nMessages: ${stats.messageCount}\nContext: ${stats.totalTokens.toLocaleString()} tokens (~${stats.estimatedPct}%)\nAPI input/output: ${tokens.apiInput.toLocaleString()} / ${tokens.apiOutput.toLocaleString()}\n\nUse /usage tools for tool stats.`,
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'insights') {
        try {
          const agent = this.getAgent(agentKey);
          const patterns = await agent.detectWorkflowPatterns(8);
          if (patterns.length === 0) {
            await platform.send(
              'No repeated workflow patterns detected yet.',
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          const lines = patterns.map(
            (p, i) =>
              `${i + 1}. ${p.name} — ${p.sequence.join(' → ')} (${p.count}x, ${p.successfulSessions} successful)`
          );
          await platform.send(
            `💡 Learning insights\n\n${lines.join('\n')}`,
            msg.channelId,
            msg.replyTo
          );
        } catch (e: any) {
          await platform.send(`Insights failed: ${e.message}`, msg.channelId, msg.replyTo);
        }
        return;
      }

      if (cmd === 'replay' || cmd === 'evals') {
        try {
          const agent = this.getAgent(agentKey);
          const parts = args.trim().split(/\s+/).filter(Boolean);
          const store = await getSessionStore();
          let sessionId: string | undefined = agent.getSessionId();
          let jobId: string | undefined;
          if (parts[0] === 'session' && parts[1]) sessionId = parts[1];
          else if (parts[0] === 'job' && parts[1]) {
            sessionId = undefined;
            jobId = parts[1];
          }
          const events = store.listObserverEvents({ sessionId, jobId }, cmd === 'evals' ? 200 : 40);
          if (cmd === 'replay') {
            if (events.length === 0) {
              await platform.send(
                'No observer events found for replay target.',
                msg.channelId,
                msg.replyTo
              );
              return;
            }
            const lines = events
              .reverse()
              .map(
                (event) =>
                  `${event.createdAt ? event.createdAt.slice(11, 19) : '--:--:--'} ${event.source}:${event.eventType}${event.status ? ` ${event.status}` : ''}${event.toolName ? ` ${event.toolName}` : ''}${event.summary ? ` — ${event.summary.replace(/\s+/g, ' ').slice(0, 100)}` : ''}`
              );
            await platform.send(
              `🎬 Replay\nTarget: ${jobId ? `job ${jobId}` : `session ${sessionId}`}\n\n${lines.join('\n')}`,
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          const evidence = sessionId ? store.listEvidenceItems(sessionId, 20) : [];
          const errors = events.filter(
            (e) => e.status === 'error' || e.eventType.includes('failed')
          );
          const toolErrors = events.filter(
            (e) => e.eventType === 'tool_end' && e.status === 'error'
          );
          const failedEvidence = evidence.filter((e) => e.status === 'failed');
          const passedEvidence = evidence.filter((e) => e.status === 'passed');
          let score =
            100 -
            Math.min(30, toolErrors.length * 10) -
            Math.min(25, errors.length * 8) -
            failedEvidence.length * 15;
          if (passedEvidence.length > 0) score += 5;
          score = Math.max(0, Math.min(100, score));
          await platform.send(
            `🧪 Agent evaluation\nTarget: ${jobId ? `job ${jobId}` : `session ${sessionId}`}\n\nScore: ${score}/100\nObserver events: ${events.length}\nTool errors: ${toolErrors.length}\nEvidence passed/failed: ${passedEvidence.length}/${failedEvidence.length}`,
            msg.channelId,
            msg.replyTo
          );
        } catch (e: any) {
          await platform.send(`${cmd} failed: ${e.message}`, msg.channelId, msg.replyTo);
        }
        return;
      }

      if (cmd === 'trash') {
        try {
          const agent = this.getAgent(agentKey);
          const [subcmd = 'list', id] = args.trim().split(/\s+/);
          const { formatTrashList, recoverTrashEntry } = await import('../agent/TrashStore.js');
          if (!args.trim() || subcmd === 'list') {
            await platform.send(
              `🗑️ Recoverable trash\n\n${formatTrashList(agent.getSessionId())}`,
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          if (subcmd === 'recover' || subcmd === 'restore') {
            await platform.send(
              id
                ? recoverTrashEntry(id, { sessionId: agent.getSessionId() })
                : 'Usage: /trash recover <id>',
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          await platform.send(
            'Usage: /trash list | /trash recover <id>',
            msg.channelId,
            msg.replyTo
          );
        } catch (e: any) {
          await platform.send(`Trash failed: ${e.message}`, msg.channelId, msg.replyTo);
        }
        return;
      }

      if (cmd === 'whoami') {
        const agent = this.getAgent(agentKey);
        await platform.send(
          `👤 ${msg.authorName}\nUser key: ${agentKey}\nProvider: ${agent.getProviderName()}\nModel: ${agent.getModel()}\nPlatform: ${msg.platform}`,
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'cost') {
        const agent = this.getAgent(agentKey);
        const stats = agent.getContextStats();
        const tokens = agent.getTokenStats();
        await platform.send(
          `💰 Token usage\nContext: ${stats.totalTokens.toLocaleString()} (~${stats.estimatedPct}%)\nAPI input/output: ${tokens.apiInput.toLocaleString()} / ${tokens.apiOutput.toLocaleString()}\nMessages: ${stats.messageCount}\nActual cost depends on your provider.`,
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'doctor') {
        const agent = this.getAgent(agentKey);
        await platform.send(
          `🩺 Gateway doctor\nNode: ${process.version}\nUptime: ${this.getUptime()}\nProvider: ${agent.getProviderName()}\nModel: ${agent.getModel()}\nTools: ${this.registry.list().length}\nPlatforms: ${this.getPlatforms().join(', ') || '(none)'}\nCron: available`,
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'permissions') {
        const raw = args.trim();
        if (raw === 'clear') {
          this.registry.clearPermissionRules();
          await platform.send('Permission allowlist cleared.', msg.channelId, msg.replyTo);
          return;
        }
        if (raw.startsWith('mode ')) {
          const mode = raw.slice(5).trim();
          if (mode === 'ask' || mode === 'bypass' || mode === 'deny') {
            this.registry.setPermissionMode(mode);
            await platform.send(`Permission mode set to: ${mode}`, msg.channelId, msg.replyTo);
            return;
          }
        }
        const rules = this.registry.listPermissionRules();
        await platform.send(
          `🔐 Permission mode: ${this.registry.getPermissionMode()}\nAlways allowed: ${rules.length ? rules.join(', ') : '(none)'}\n\nUsage: /permissions mode ask|bypass|deny · /permissions clear`,
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'yolo') {
        this.registry.setPermissionMode('bypass');
        await platform.send(
          '⚡ YOLO mode ON — tool calls auto-approved. Use /permissions mode ask to revert.',
          msg.channelId,
          msg.replyTo
        );
        return;
      }

      if (cmd === 'cron') {
        const raw = args.trim();
        const [subcmd = 'list', ...rest] = raw.split(/\s+/);
        const action = subcmd.toLowerCase();
        try {
          if (!raw || action === 'list') {
            const jobs = await this.cronDaemon.listJobs();
            if (jobs.length === 0) {
              await platform.send(
                'No scheduled jobs. Add one with: /cron add <cron expr> | <prompt>',
                msg.channelId,
                msg.replyTo
              );
              return;
            }
            const lines = jobs.map(
              (j, i) =>
                `${i + 1}. ${j.id} ${j.status} ${j.schedule} — ${j.prompt.slice(0, 100)}${j.lastRunAt ? ` (last: ${j.lastRunAt})` : ''}`
            );
            await platform.send(
              `⏰ Scheduled jobs\n\n${lines.join('\n')}\n\nCommands: /cron add <expr> | <prompt> · /cron remove <id> · /cron run <id>`,
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          if (action === 'add') {
            const spec = rest.join(' ');
            const parts = spec.split('|');
            if (parts.length < 2) {
              await platform.send(
                'Usage: /cron add <cron expr> | <prompt>\nExample: /cron add 0 9 * * * | research China AI news',
                msg.channelId,
                msg.replyTo
              );
              return;
            }
            const schedule = parts[0].trim();
            const prompt = parts.slice(1).join('|').trim();
            const job = await this.cronDaemon.addJob(schedule, prompt, {
              platform: msg.platform,
              channelId: msg.channelId,
              replyTo: msg.replyTo,
            });
            await platform.send(
              `⏰ Scheduled job added: ${job.id}\n${job.schedule}\n${job.prompt}`,
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          if (action === 'remove' || action === 'delete' || action === 'rm') {
            const id = rest[0];
            if (!id) {
              await platform.send('Usage: /cron remove <id>', msg.channelId, msg.replyTo);
              return;
            }
            const removed = await this.cronDaemon.removeJob(id);
            await platform.send(
              removed ? `Removed scheduled job: ${id}` : `No scheduled job found: ${id}`,
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          if (action === 'run') {
            const id = rest[0];
            if (!id) {
              await platform.send('Usage: /cron run <id>', msg.channelId, msg.replyTo);
              return;
            }
            const run = await this.cronDaemon.runJob(id, { deliver: false });
            await platform.send(
              run.status === 'success'
                ? `Cron job ${id} completed.\n\n${stripMarkdown(run.result || '')}`
                : `Cron job ${id} failed: ${run.error || 'unknown error'}`,
              msg.channelId,
              msg.replyTo
            );
            return;
          }
          await platform.send(
            'Usage: /cron list | /cron add <expr> | <prompt> | /cron remove <id> | /cron run <id>',
            msg.channelId,
            msg.replyTo
          );
        } catch (e: any) {
          await platform.send(`Cron error: ${e.message}`, msg.channelId, msg.replyTo);
        }
        return;
      }

      if (cmd === 'review') {
        text = args.trim()
          ? `[REVIEW REQUEST] Review the following code for bugs, security issues, and improvements:\n\n${args}`
          : '[REVIEW REQUEST] Review the current repository for bugs, regressions, security issues, and missing tests. Start by inspecting git status and the relevant diff.';
      }

      if (cmd === 'code-review') {
        text =
          '[CODE REVIEW REQUEST] Review the current git diff for correctness bugs, regressions, missing error handling, and risky changes. Return concrete findings with file paths and line numbers.';
      }

      if (cmd === 'security-review') {
        text =
          '[SECURITY REVIEW REQUEST] Scan the current codebase and diff for injection, auth, secrets, SSRF, unsafe file/network access, and OWASP-style vulnerabilities. Return concrete findings with file paths and line numbers.';
      }

      if (cmd === 'diff') {
        text =
          '[DIFF REVIEW REQUEST] Inspect the current git diff and summarize what changed, risks, and recommended verification steps.';
      }

      if (cmd === 'verify') {
        text =
          '[VERIFY REQUEST] Verify the current changes by running the relevant build/typecheck/tests or runtime smoke checks, then report exactly what passed, failed, or was skipped.';
      }

      if (cmd === 'research') {
        if (!args.trim()) {
          await platform.send('🔬 Usage: /research <topic>', msg.channelId, msg.replyTo);
          return;
        }
        text = `[RESEARCH REQUEST] Research this topic with sources and a concise final synthesis:\n\n${args}`;
      }

      if (cmd === 'research-forums') {
        if (!args.trim()) {
          await platform.send('🌐 Usage: /research-forums <topic>', msg.channelId, msg.replyTo);
          return;
        }
        text = `[FORUM RESEARCH REQUEST] Research this topic across public forums/social sources where available, cite sources, and summarize sentiment and concrete findings:\n\n${args}`;
      }

      if (cmd === 'summarize') {
        if (!args.trim()) {
          await platform.send('📝 Usage: /summarize <text or topic>', msg.channelId, msg.replyTo);
          return;
        }
        text = `[SUMMARY REQUEST] Summarize the following clearly with key points, action items, and risks if any:\n\n${args}`;
      }

      if (cmd === 'pdf' || cmd === 'pptx' || cmd === 'xlsx') {
        if (!args.trim()) {
          await platform.send(`📄 Usage: /${cmd} <content or topic>`, msg.channelId, msg.replyTo);
          return;
        }
        const kind =
          cmd === 'pdf' ? 'PDF document' : cmd === 'pptx' ? 'PowerPoint deck' : 'Excel spreadsheet';
        text = `[DOCUMENT REQUEST] Generate a ${kind} for the following request. Use the appropriate document/file tools when available, save the file, and mention the output path so the gateway can send it back:\n\n${args}`;
      }

      if (cmd === 'deep' || cmd === 'deep-research') {
        const topic = args.trim();
        this.userDepths.set(agentKey, 'ultra');
        const deepAgent = this.getAgent(agentKey);
        deepAgent.setResearchMode('ultra' as any);
        this.config.researchMode = 'ultra' as any;
        saveConfig(this.config);
        if (!topic) {
          await platform.send(
            '🧠 Deep mode enabled: depth set to ultra. Use /deep_research <topic> to run a research task.',
            msg.channelId,
            msg.replyTo
          );
          return;
        }
        text = `[DEEP RESEARCH REQUEST] Run maximum-depth research/multi-agent analysis on:\n\n${topic}`;
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
      const wantsTable =
        /\b(table|tabel|comparison|compare|perbandingan|harga|pricing|price|biaya|spec|specs|benchmark)\b/i.test(
          userPrompt
        );
      const tableFormatTag =
        wantsTable && msg.platform !== 'whatsapp'
          ? ' [format requirement: user requested structured comparison/table; output a compact markdown pipe table with headers and rows, not bullet-card sections]'
          : '';
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
      const taggedPrompt = `${platformTag}${tableFormatTag}${forwardTag}${attachTag} ${userPrompt}`;

      const agent = this.getAgent(agentKey);
      const selectedDepth = this.userDepths.get(agentKey);
      if (selectedDepth) agent.setResearchMode(selectedDepth as any);
      this.activeProcessing.add(agentKey);

      try {
        let fullResponse = '';
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

        let lastChunkAt = 0;
        let pendingChunkText = '';
        let lastPublishedChunkText = '';
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
            pendingChunkText = '';
            lastPublishedChunkText = '';
            lastChunkAt = 0;
            const toolName = event.toolName || event.data;
            const renderedStatus = gatewayText(
              renderToolStart({ toolName, args: event.toolArgs }),
              platform.name
            );
            await publishProgress(renderedStatus);
            sawToolStatus = true;
          } else if (event.type === 'tool_chunk') {
            pendingChunkText = `${pendingChunkText}\n${event.data}`.trim().slice(-1200);
            const now = Date.now();
            if (now - lastChunkAt >= 1500) {
              lastChunkAt = now;
              lastPublishedChunkText = pendingChunkText;
              const renderedStatus = gatewayText(
                `📡 Live ${event.toolName || 'tool'} output\n${pendingChunkText}`,
                platform.name
              );
              await publishProgress(renderedStatus);
            }
            sawToolStatus = true;
          } else if (event.type === 'tool_end') {
            if (pendingChunkText && pendingChunkText !== lastPublishedChunkText) {
              lastPublishedChunkText = pendingChunkText;
              const liveStatus = gatewayText(
                `📡 Live ${event.toolName || 'tool'} output\n${pendingChunkText}`,
                platform.name
              );
              await publishProgress(liveStatus);
            }
            const renderedStatus = gatewayText(
              renderToolEnd({
                toolName: event.toolName,
                data: event.data,
                durationMs: event.durationMs,
                status: event.status,
                errorType: event.errorType,
              }),
              platform.name
            );
            await publishProgress(renderedStatus);
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
          const maxLen =
            platform.name === 'discord'
              ? 1900
              : platform.name === 'telegram' && looksLikeMarkdownTable(rendered.text)
                ? 32000
                : 4000;
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
      if (userKey === 'default') continue;
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
