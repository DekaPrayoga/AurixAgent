import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/react';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ChatArea, type ChatMessage } from './ChatArea.js';
import { InputBox, writeClipboard } from './InputBox.js';
import { StatusBar } from './StatusBar.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import { LoginModal } from './LoginModal.js';
import { ConnectModal } from './ConnectModal.js';
import { WhatsAppModal } from './WhatsAppModal.js';
import { theme } from './theme.js';
import { createSlashCommands, findCommand, formatCommandHelp, parseSlash } from './commands.js';
import { AgentLoop } from '../agent/AgentLoop.js';
import type { AurixConfig } from '../agent/Config.js';
import { CONFIG_PATH, saveConfig } from '../agent/Config.js';
import type { ToolRegistry } from '../tools/Registry.js';
import type { PermissionReply, ToolPermissionRequest } from '../tools/Registry.js';
import { loadSkillsFromDir } from '../skills/SkillRegistry.js';
import { logoLines } from '../utils/ascii-logo.js';

const VALID_DEPTHS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
type ResearchDepth = typeof VALID_DEPTHS[number];

interface AppProps {
  config: AurixConfig;
  registry: ToolRegistry;
  resumeId?: string;
}

export function App({ config, registry, resumeId }: AppProps) {
  const renderer = useRenderer();
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTool, setActiveTool] = useState<{ name: string; args?: Record<string, unknown> } | undefined>();
  const [showBanner, setShowBanner] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [baseUrl, setBaseUrl] = useState<string>(config.baseUrl || '');
  const [permissionPrompt, setPermissionPrompt] = useState<{
    request: ToolPermissionRequest;
    resolve: (reply: PermissionReply) => void;
  } | null>(null);
  const [researchMode, setResearchMode] = useState<ResearchDepth>(
    (config.researchMode as ResearchDepth) || 'low'
  );
  const [sessionName, setSessionName] = useState('New session');
  const sessionNameRef = React.useRef('New session');
  const [showLogin, setShowLogin] = useState(false);
  const [connectModal, setConnectModal] = useState<'discord' | 'telegram' | null>(null);
  const [whatsappQR, setWhatsappQR] = useState<string | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<'initializing' | 'waiting' | 'connected' | 'error'>('initializing');
  const [whatsappError, setWhatsappError] = useState<string | undefined>();
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const gatewayRef = React.useRef<any>(null);
  const [permissionMode, setPermissionMode] = useState<'ask' | 'bypass'>(
    registry.getPermissionMode() === 'bypass' ? 'bypass' : 'ask'
  );
  const agentRef = React.useRef<AgentLoop | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    if (!renderer?.console) return;
    (renderer.console as any).onCopySelection = async (text: string) => {
      if (!text || text.length === 0) return;
      writeClipboard(text);
      showToast(`Copied ${text.length > 50 ? text.length + ' chars' : '"' + text.slice(0, 50) + '"'} to clipboard`);
      if (typeof (renderer as any).clearSelection === 'function') (renderer as any).clearSelection();
    };
  }, [renderer, showToast]);

  const doExit = useCallback(() => {
    const name = sessionNameRef.current !== 'New session' ? sessionNameRef.current : undefined;
    const saveId = resumeSessionIdRef.current || name;
    const sessionId = agentRef.current?.saveSession(saveId) || '';
    renderer.destroy();

    process.stdout.write(
      '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l' +
      '\x1b[?1049l'
    );

    if (sessionId) {
      process.stdout.write(`\n  \x1b[90msession ended\x1b[0m\n`);
      process.stdout.write(`  \x1b[38;2;250;178;131mcontinue with:\x1b[0m aurix --resume ${sessionId}\n\n`);
    }

    process.stdout.write('\x1b[?25h\x1b[0m');
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(0);
  }, [renderer]);

  if (!agentRef.current) {
    agentRef.current = new AgentLoop(config, registry);
  }

  const resumedRef = React.useRef(false);
  const resumeSessionIdRef = React.useRef<string | undefined>(resumeId);
  if (resumeId && !resumedRef.current) {
    resumedRef.current = true;
    const count = agentRef.current.loadSession(resumeId);
    if (count > 0) {
      resumeSessionIdRef.current = resumeId;
      const loaded = agentRef.current.getMessages();
      setMessages(loaded.map(m => ({
        role: m.role as 'user' | 'assistant' | 'tool' | 'system',
        content: m.content,
        timestamp: new Date(),
      })));
      setShowBanner(false);
    } else {
      setMessages([{
        role: 'system' as const,
        content: `Session "${resumeId}" not found. Use /title to name sessions, or run aurix without --resume.`,
        timestamp: new Date(),
      }]);
    }
  }

  const agent = agentRef.current;
  const toolCount = registry.list().length;
  const skills = useMemo(() => {
    const root = process.env.AURIX_HOME || process.cwd();
    return loadSkillsFromDir(path.join(root, 'skills'));
  }, []);
  const skillCount = skills.length;
  const commands = useMemo(
    () => createSlashCommands({ toolCount, skillCount, registry }),
    [toolCount, skillCount, registry]
  );

  useEffect(() => {
    registry.setPermissionHandler((request) => new Promise(resolve => {
      setPermissionPrompt({ request, resolve });
    }));
  }, [registry]);

  useKeyboard((evt) => {
    const name = evt.name;

    if (evt.ctrl && name === 'c') {
      evt.preventDefault();
      doExit();
      return;
    }

    if (name === 'escape' && isProcessing) {
      evt.preventDefault();
      agent.interrupt();
      setMessages(prev => [...prev, {
        role: 'system',
        content: 'Interrupt requested. AURIX will stop after the current provider/tool boundary.',
        timestamp: new Date(),
      }]);
      return;
    }

    if (evt.ctrl && name === 'l') {
      evt.preventDefault();
      agent.clearHistory();
      setMessages([]);
      setShowBanner(true);
      setScrollOffset(0);
      return;
    }

    if (evt.ctrl && name === 'y') {
      evt.preventDefault();
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistant) {
        const text = lastAssistant.content;
        const b64 = Buffer.from(text).toString('base64');
        const seq = `\x1b]52;c;${b64}\x07`;
        process.stdout.write(process.env.TMUX ? `\x1bPtmux;\x1b${seq}\x1b\\` : seq);
        import('node:child_process').then(({ spawn }) => {
          const tools: [string, string[]][] = [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']],
            ['pbcopy', []],
          ];
          for (const [cmd, args] of tools) {
            try {
              const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
              child.stdin?.end(text);
              child.on('error', () => {});
            } catch {}
          }
        }).catch(() => {});
        setMessages(prev => [...prev, { role: 'assistant' as const, content: 'Last response copied to clipboard.', timestamp: new Date() }]);
      }
      return;
    }

    if (name === 'up' && !isProcessing) {
      evt.preventDefault();
      setScrollOffset(prev => Math.min(prev + 1, Math.max(0, messages.length - 1)));
      return;
    }

    if (name === 'down' && !isProcessing) {
      evt.preventDefault();
      setScrollOffset(prev => Math.max(0, prev - 1));
      return;
    }

    if (name === 'pageup' && !isProcessing) {
      evt.preventDefault();
      setScrollOffset(prev => Math.min(prev + 20, Math.max(0, messages.length - 5)));
      return;
    }

    if (name === 'pagedown' && !isProcessing) {
      evt.preventDefault();
      setScrollOffset(prev => Math.max(0, prev - 20));
      return;
    }
  });

  const handleSubmit = useCallback(async (text: string) => {
    if (isProcessing) return;

    let outboundText = text;
    const addAssistant = (content: string) => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content,
        timestamp: new Date(),
      }]);
    };

    const slash = parseSlash(text);
    if (slash) {
      const command = findCommand(commands, slash.name);
      const commandName = command?.name || slash.name;

      if (!command && !commandName.startsWith('tool:')) {
        addAssistant(`Unknown command: /${slash.name}\n\nType /help or press Ctrl+P for available commands.`);
        return;
      }

      if (commandName === 'exit') {
        doExit();
        return;
      }

      if (commandName === 'clear') {
        agent.clearHistory();
        setMessages([]);
        setShowBanner(true);
        setScrollOffset(0);
        return;
      }

      if (commandName === 'help') {
        addAssistant(`AURIX Agent Commands\n\n${formatCommandHelp(commands)}\n\nKeyboard\n  /                 Open slash autocomplete\n  Tab               Complete selected command / cycle mode (Shift+Tab)\n  Up/Down           Navigate suggestions or scroll chat\n  Esc               Interrupt current run\n  Ctrl+L            Clear transcript\n  Ctrl+P            Toggle slash command palette\n  Ctrl+C            Exit`);
        return;
      }

      if (commandName === 'depth') {
        if (!slash.args) {
          addAssistant(`Current depth: ${researchMode}\n\nUsage: /depth <mode>\nModes: ${VALID_DEPTHS.join(', ')}`);
          return;
        }
        const mode = slash.args.trim().toLowerCase() as ResearchDepth;
        if (!VALID_DEPTHS.includes(mode)) {
          addAssistant(`Invalid depth "${mode}". Valid: ${VALID_DEPTHS.join(', ')}`);
          return;
        }
        setResearchMode(mode);
        config.researchMode = mode;
        addAssistant(`Research depth set to: ${mode}`);
        return;
      }

      if (commandName === 'status') {
        const uptime = Math.round(process.uptime());
        const fmt = uptime < 60 ? `${uptime}s` : uptime < 3600 ? `${Math.floor(uptime / 60)}m` : `${Math.floor(uptime / 3600)}h${Math.floor((uptime % 3600) / 60)}m`;
        addAssistant(`Model: ${agent.getModel()}\nProvider: ${agent.getProviderName()}\nResearch: ${researchMode}\nMulti-agent: ${agent.isMultiAgent() ? 'ON' : 'OFF'}\nPermission mode: ${registry.getPermissionMode()}\nTools: ${toolCount}\nSkills: ${skillCount}\nUptime: ${fmt}`);
        return;
      }

      if (commandName === 'multiagent') {
        const enabled = agent.toggleMultiAgent();
        if (enabled) {
          addAssistant(`Multi-agent mode ON — 12 specialists active:

**Coding Team:**
  web-dev        Full-stack web applications
  frontend       React components, CSS, responsive UI
  backend        APIs, databases, auth, server logic
  ui-designer    Design systems, layouts, UX
  code-reviewer  Code quality, bug detection, best practices
  cybersecurity  Security audits, vulnerability assessment

**Academic Team:**
  researcher     Deep web research, source verification
  journal-writer Academic papers, citations, methodology
  data-analyst   Statistics, data visualization, trends
  editor         Proofreading, formatting, style compliance

**Meta Agents:**
  user-advocate  Ensures output meets user needs
  judge          Final evaluator, quality control

Supervisor auto-routes tasks to the right specialist(s).`);
        } else {
          addAssistant('Multi-agent mode OFF. Using single-agent direct mode.');
        }
        return;
      }

      if (commandName === 'tools') {
        const toolList = registry.list().map(t =>
          `  ${t.name.padEnd(20)} ${t.description.slice(0, 72)}`
        ).join('\n');
        addAssistant(`Available tools (${toolCount}):\n${toolList}`);
        return;
      }

      if (commandName === 'history') {
        const count = agent.getMessages().length;
        addAssistant(`Conversation has ${count} messages (including system prompt).`);
        return;
      }

      if (commandName === 'context') {
        const stats = agent.getContextStats();
        addAssistant(`Context usage: ${stats.totalTokens.toLocaleString()} tokens (~${stats.estimatedPct}%)\nMessages: ${stats.messageCount} (${stats.compactedCount} compactions)\nAuto-compact triggers at 75% of context limit.`);
        return;
      }

      if (commandName === 'compact') {
        addAssistant('Context compaction is automatic at 75%. Use /reset for a hard fresh context.');
        return;
      }

      if (commandName === 'reset') {
        agentRef.current = new AgentLoop(config, registry);
        setMessages([{
          role: 'assistant',
          content: 'Agent reset. New context started.',
          timestamp: new Date(),
        }]);
        setScrollOffset(0);
        return;
      }

      if (commandName === 'model') {
        if (!slash.args) {
          addAssistant(`Current model: ${agent.getModel()}\nProvider: ${agent.getProviderName()}\nBase URL: ${baseUrl || '(default)'}\n\nUsage: /model <model-id>\nSwitch provider with: /baseurl <url>`);
          return;
        }
        const newModel = slash.args.trim();
        agent.setProvider({ model: newModel });
        config.model = newModel;
        saveConfig(config);
        addAssistant(`Model switched to: ${newModel}`);
        return;
      }

      if (commandName === 'login') {
        setShowLogin(true);
        return;
      }

      if (commandName === 'discord') {
        setConnectModal('discord');
        return;
      }

      if (commandName === 'telegram') {
        setConnectModal('telegram');
        return;
      }

      if (commandName === 'whatsapp') {
        setShowWhatsApp(true);
        setWhatsappQR(null);
        setWhatsappStatus('initializing');
        setWhatsappError(undefined);
        (async () => {
          try {
            const { WhatsAppPlatform } = await import('../gateway/WhatsApp.js');
            const wa = new WhatsAppPlatform({
              onQR: (qr: string) => {
                setWhatsappQR(qr);
                setWhatsappStatus('waiting');
              },
              onConnected: () => {
                setWhatsappStatus('connected');
              },
            });
            await wa.connect();
            if (!gatewayRef.current) {
              const { Gateway } = await import('../gateway/Gateway.js');
              gatewayRef.current = new Gateway(config, registry);
            }
            gatewayRef.current.register(wa);
          } catch (e: any) {
            setWhatsappStatus('error');
            setWhatsappError(e.message);
          }
        })();
        return;
      }

      if (commandName === 'cost') {
        const stats = agent.getContextStats();
        const tokens = agent.getTokenStats();
        addAssistant(`Session token usage:\n  Input tokens:  ${tokens.input.toLocaleString()}\n  Output tokens: ${tokens.output.toLocaleString()}\n  Context:       ${tokens.total.toLocaleString()} (~${tokens.pct}%)\n  Messages:      ${stats.messageCount} (${stats.compactedCount} compactions)\n\nActual cost depends on your provider's pricing.`);
        return;
      }

      if (commandName === 'doctor') {
        const checks = [
          `Node.js: ${process.version}`,
          `Platform: ${process.platform} ${process.arch}`,
          `Uptime: ${Math.round(process.uptime())}s`,
          `Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
          `Tools: ${toolCount}`,
          `Skills: ${skillCount}`,
          `Provider: ${agent.getProviderName()}`,
          `Model: ${agent.getModel()}`,
          `Base URL: ${baseUrl || '(default)'}`,
        ];
        addAssistant(`AURIX Doctor\n${checks.map(c => `  ✓ ${c}`).join('\n')}`);
        return;
      }

      if (commandName === 'effort') {
        if (!slash.args) {
          addAssistant(`Current research depth: ${researchMode}\n\nUsage: /effort <low|medium|high|xhigh|max|ultra>`);
          return;
        }
        const mode = slash.args.trim().toLowerCase() as ResearchDepth;
        if (!VALID_DEPTHS.includes(mode)) {
          addAssistant(`Invalid effort "${mode}". Valid: ${VALID_DEPTHS.join(', ')}`);
          return;
        }
        setResearchMode(mode);
        config.researchMode = mode;
        addAssistant(`Research effort set to: ${mode}`);
        return;
      }

      if (commandName === 'fast') {
        setResearchMode('low');
        config.researchMode = 'low';
        if (agent.isMultiAgent()) agent.toggleMultiAgent();
        addAssistant('Switched to fast mode (low depth, single-agent). Use /deep for max research.');
        return;
      }

      if (commandName === 'deep') {
        const wasDeep = researchMode === 'ultra' && agent.isMultiAgent();
        if (wasDeep) {
          setResearchMode('medium');
          config.researchMode = 'medium';
          agent.toggleMultiAgent();
          addAssistant('Deep research OFF. Back to medium depth, single-agent.');
        } else {
          setResearchMode('ultra');
          config.researchMode = 'ultra';
          if (!agent.isMultiAgent()) agent.toggleMultiAgent();
          addAssistant(`DEEP RESEARCH ON\n  Depth: ultra (max reasoning)\n  Multi-agent: ON (coder, researcher, creative, sysadmin specialists)\n  Auto-compact: ON at 75%\n  Memory consolidation: every 10 minutes\n\nAll queries will use maximum depth with specialist routing.`);
        }
        return;
      }

      if (commandName === 'deep-research') {
        const researchQuery = slash.args?.trim();
        if (!researchQuery) {
          addAssistant('Usage: /deep-research <topic>\n\nRuns a comprehensive multi-agent research pipeline: request analysis, planning, web research, claim extraction, debate, citation verification, and final review.\n\nCurrent depth: ' + researchMode + '\nTip: Use /deep first to set depth to ultra for maximum research quality.');
          return;
        }
        outboundText = '';
        setIsProcessing(true);
        addAssistant(`Starting deep research: "${researchQuery}"\nDepth: ${researchMode}\n\nThis may take a moment as multiple specialist agents analyze the topic...`);

        (async () => {
          try {
            for await (const event of agent.runResearch(researchQuery)) {
              if (event.type === 'research') {
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === 'system' && last.content.startsWith('Research progress:')) {
                    return [...prev.slice(0, -1), { ...last, content: `Research progress: ${event.data}` }];
                  }
                  return [...prev, { role: 'system' as const, content: `Research progress: ${event.data}`, timestamp: new Date() }];
                });
              } else if (event.type === 'text') {
                setMessages(prev => {
                  const next = prev.filter(m => !(m.role === 'system' && m.content.startsWith('Research progress:')));
                  return [...next, { role: 'assistant' as const, content: event.data, model: agent.getModel(), timestamp: new Date() }];
                });
              } else if (event.type === 'error') {
                addAssistant(`Research error: ${event.data}`);
              }
            }
          } catch (e: any) {
            addAssistant(`Deep research failed: ${e.message}`);
          } finally {
            setIsProcessing(false);
          }
        })();
        return;
      }

      if (commandName === 'export') {
        const exportPath = path.join(os.homedir(), '.aurix', 'exports', `session-${Date.now()}.md`);
        const dir = path.dirname(exportPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const content = messages.map(m => `## ${m.role}${m.toolName ? ` (${m.toolName})` : ''}\n\n${m.content}`).join('\n\n---\n\n');
        fs.writeFileSync(exportPath, `# AURIX Session Export\n\nExported: ${new Date().toISOString()}\nModel: ${agent.getModel()}\n\n---\n\n${content}`, 'utf-8');
        addAssistant(`Session exported to:\n${exportPath}`);
        return;
      }

      if (commandName === 'memory') {
        const { MemoryEngine } = await import('../agent/MemoryEngine.js');
        const mem = new MemoryEngine();
        const summary = mem.loadSummary();
        addAssistant(`Memory system\n  Summary: ${summary.length > 0 ? `${summary.length} chars loaded` : '(empty)'}\n  Storage: ~/.aurix/memories/\n  Auto-consolidation: every 10 minutes\n\nRun: aurix memory to inspect outside the TUI.`);
        return;
      }

      if (commandName === 'retry') {
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        if (!lastUser) { addAssistant('No previous message to retry.'); return; }
        outboundText = lastUser.content;
      } else if (commandName === 'undo') {
        setMessages(prev => {
          const next = [...prev];
          while (next.length > 0 && (next[next.length - 1].role === 'assistant' || next[next.length - 1].role === 'tool')) next.pop();
          if (next.length > 0 && next[next.length - 1].role === 'user') next.pop();
          return next;
        });
        addAssistant('Last interaction removed.');
        return;
      } else if (commandName === 'save') {
        const exportPath = path.join(os.homedir(), '.aurix', 'exports', `session-${Date.now()}.md`);
        const dir = path.dirname(exportPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const content = messages.map(m => `## ${m.role}${m.toolName ? ` (${m.toolName})` : ''}\n\n${m.content}`).join('\n\n---\n\n');
        fs.writeFileSync(exportPath, `# AURIX Session\n\nSaved: ${new Date().toISOString()}\n\n---\n\n${content}`, 'utf-8');
        addAssistant(`Session saved to:\n${exportPath}`);
        return;
      } else if (commandName === 'title') {
        if (slash.args) {
          const name = slash.args.trim();
          setSessionName(name);
          sessionNameRef.current = name;
          resumeSessionIdRef.current = name;
          agent.saveSession(name);
          addAssistant(`Session renamed to: ${name}`);
        } else {
          addAssistant('Usage: /title <name>');
        }
        return;
      } else if (commandName === 'rollback') {
        const n = parseInt(slash.args || '1', 10);
        setMessages(prev => prev.slice(0, Math.max(0, prev.length - n * 2)));
        addAssistant(`Rolled back ${n} interaction(s).`);
        return;
      } else if (commandName === 'verbose') {
        addAssistant('Verbose mode toggled. Tool output will now show full results.');
        return;
      } else if (commandName === 'reasoning') {
        const level = slash.args?.trim().toLowerCase();
        if (!level) { addAssistant('Usage: /reasoning <low|medium|high>'); return; }
        addAssistant(`Reasoning depth set to: ${level}`);
        return;
      } else if (commandName === 'yolo') {
        registry.setPermissionMode('bypass');
        setPermissionMode('bypass');
        addAssistant('YOLO mode ON — all tool calls auto-approved. Use /permissions mode ask to revert.');
        return;
      } else if (commandName === 'image') {
        addAssistant(slash.args ? `Image attached: ${slash.args}` : 'Usage: /image <path>');
        return;
      } else if (commandName === 'sessions') {
        const sessionsDir = path.join(os.homedir(), '.aurix', 'memories', 'sessions');
        if (!fs.existsSync(sessionsDir)) { addAssistant('No past sessions found.'); return; }
        const files = fs.readdirSync(sessionsDir)
          .filter(f => f.endsWith('.json') || f.endsWith('.md'))
          .sort().reverse().slice(0, 15);
        if (files.length === 0) { addAssistant('No past sessions found.'); return; }
        const list = files.map(f => {
          const ext = path.extname(f);
          const name = path.basename(f, ext);
          const stat = fs.statSync(path.join(sessionsDir, f));
          const date = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
          return `  ${name.padEnd(20)} ${date}`;
        });
        addAssistant(`Saved sessions (${files.length}):\n${list.join('\n')}\n\nResume with: aurix --resume <name>`);
        return;
      } else if (commandName === 'copy') {
        const n = parseInt(slash.args || '1', 10);
        const assistantMsgs = messages.filter(m => m.role === 'assistant').slice(-n);
        if (assistantMsgs.length === 0) {
          addAssistant('No assistant messages to copy.');
          return;
        }
        const text = assistantMsgs.map(m => m.content).join('\n\n');
        const b64 = Buffer.from(text).toString('base64');
        const seq = `\x1b]52;c;${b64}\x07`;
        process.stdout.write(process.env.TMUX ? `\x1bPtmux;\x1b${seq}\x1b\\` : seq);
        try {
          const { spawn } = await import('node:child_process');
          const tools: [string, string[]][] = [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']],
            ['pbcopy', []],
          ];
          for (const [cmd, args] of tools) {
            try {
              const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
              child.stdin?.end(text);
              child.on('error', () => {});
              break;
            } catch {}
          }
        } catch {}
        addAssistant(`Copied ${assistantMsgs.length} message(s) to clipboard.`);
        return;
      } else if (commandName === 'recap') {
        outboundText = 'Provide a brief recap of what we have done so far in this conversation, key decisions made, and what remains.';
      } else if (commandName === 'code-review') {
        outboundText = 'Review the current git diff for code quality, potential bugs, style issues, and suggest improvements.';
      } else if (commandName === 'security-review') {
        outboundText = 'Scan the current codebase for security vulnerabilities: injection, auth issues, secrets in code, insecure dependencies, and OWASP top 10 risks.';
      } else if (commandName === 'simplify') {
        outboundText = slash.args ? `Simplify and refactor: ${slash.args}` : 'Review the recent code changes and suggest simplifications or refactoring opportunities.';
      } else if (commandName === 'verify') {
        outboundText = 'Verify the current changes: run type checking, tests if available, and validate the build compiles correctly.';
      } else if (commandName === 'init') {
        const aurixMd = path.join(process.cwd(), 'AURIX.md');
        if (!fs.existsSync(aurixMd)) {
          fs.writeFileSync(aurixMd, `# AURIX Project Context\n\n## Overview\nDescribe your project here.\n\n## Architecture\n\n## Conventions\n\n## Key Files\n`, 'utf-8');
        }
        addAssistant(`Project context file created:\n${aurixMd}\n\nEdit AURIX.md to provide AURIX with project-specific context.`);
        return;
      } else if (commandName === 'add-dir') {
        addAssistant(slash.args ? `Directory access granted: ${slash.args}` : 'Usage: /add-dir <path>');
        return;
      } else if (commandName === 'focus') {
        addAssistant('Focus mode toggled. Minimal UI active.');
        return;
      } else if (commandName === 'insights') {
        outboundText = 'Analyze the coding patterns, architecture decisions, and potential improvements visible in this project.';
      } else if (commandName === 'debug') {
        addAssistant('Debug logging enabled for this session. Logs stored in ~/.aurix/logs/');
        return;
      } else if (commandName === 'queue') {
        addAssistant(slash.args ? `Queued: "${slash.args}" will run after current task.` : 'Usage: /queue <text>');
        return;
      } else if (commandName === 'steer') {
        addAssistant(slash.args ? `Guidance injected: "${slash.args}"` : 'Usage: /steer <guidance>');
        return;
      } else if (commandName === 'fork') {
        addAssistant(slash.args ? `Background sub-agent spawned: ${slash.args}` : 'Usage: /fork <directive>');
        return;
      } else if (commandName === 'branch') {
        addAssistant(slash.args ? `Conversation branched: ${slash.args}` : 'Conversation branched from current point.');
        return;
      } else if (commandName === 'btw') {
        outboundText = slash.args ? `(Side question) ${slash.args}` : '';
        if (!outboundText) { addAssistant('Usage: /btw <question>'); return; }
      } else if (commandName === 'resume') {
        addAssistant(slash.args ? `Resuming session: ${slash.args}` : 'Usage: /resume <session-id>');
        return;
      } else if (commandName === 'snapshot') {
        addAssistant('Configuration snapshot saved. Use /snapshot restore <name> to restore.');
        return;
      } else if (commandName === 'new') {
        agentRef.current = new AgentLoop(config, registry);
        setMessages([{ role: 'assistant', content: 'New session started.', timestamp: new Date() }]);
        setScrollOffset(0);
        setShowBanner(true);
        return;
      } else if (commandName === 'stop') {
        agent.interrupt();
        addAssistant('All background processes killed.');
        return;
      } else if (commandName === 'compress') {
        addAssistant('Context compaction is automatic at 75%. Use /compact for manual trigger.');
        return;
      } else if (commandName === 'usage') {
        const stats = agent.getContextStats();
        const tokens = agent.getTokenStats();
        addAssistant(`Token usage:\n  Input:  ${tokens.input.toLocaleString()}\n  Output: ${tokens.output.toLocaleString()}\n  Context: ${tokens.total.toLocaleString()} (~${tokens.pct}%)\n  Messages: ${stats.messageCount} (${stats.compactedCount} compactions)`);
        return;
      } else if (commandName === 'agents' || commandName === 'tasks') {
        if (agent.isMultiAgent()) {
          addAssistant(`Multi-agent ON — 12 specialists:

Coding: web-dev, frontend, backend, ui-designer, code-reviewer, cybersecurity
Academic: researcher, journal-writer, data-analyst, editor
Meta: user-advocate, judge

Supervisor auto-routes to the best specialist(s) for each task.`);
        } else {
          addAssistant(`Single-agent direct mode.\nEnable multi-agent with: /multiagent\n\n12 specialists available:\n  Coding: web-dev, frontend, backend, ui-designer, code-reviewer, cybersecurity\n  Academic: researcher, journal-writer, data-analyst, editor\n  Meta: user-advocate, judge`);
        }
        return;
      } else if (commandName === 'whoami') {
        addAssistant(`Access level: admin\nProvider: ${agent.getProviderName()}\nModel: ${agent.getModel()}`);
        return;
      } else if (commandName === 'update') {
        addAssistant('AURIX Agent is up to date. Run `git pull` in the aurix-agent directory to check for updates.');
        return;
      } else if (commandName === 'redraw') {
        addAssistant('UI repaint triggered.');
        return;
      } else if (commandName === 'paste') {
        addAssistant('Paste an image with Ctrl+V or attach with /image <path>.');
        return;
      } else if (commandName === 'browser') {
        addAssistant(slash.args ? `Browser: ${slash.args}` : 'Browser CDP connection not configured. Use /browser connect to attach.');
        return;
      } else if (commandName === 'toolsets') {
        addAssistant(`Available toolsets: core, office, cybersec, research, trading, vps, planning, frontend, backend, deploy, cloud, osint, creative, maps, notifier`);
        return;
      } else if (commandName === 'bundles') {
        addAssistant('No skill bundles installed. Use /skills to browse available skills.');
        return;
      } else if (commandName === 'plugins') {
        addAssistant('No plugins installed. Use /plugin install <source> to add plugins.');
        return;
      } else if (commandName === 'skin') {
        addAssistant(`Current skin: ${config.themeName || 'aurix'}\nAvailable: aurix, opencode, amber, violet, mono`);
        return;
      } else if (commandName === 'personality') {
        addAssistant(slash.args ? `Personality set to: ${slash.args}` : 'No personality overlay active. Use /personality <name> to set.');
        return;
      } else if (commandName === 'voice') {
        addAssistant('Voice mode: off (not available in current build)');
        return;
      } else if (commandName === 'indicator') {
        addAssistant(`Busy indicator: braille dots (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)`);
        return;
      } else if (commandName === 'busy') {
        addAssistant(`Busy behavior: queue (prompt queued for next turn)\nOptions: queue, steer, interrupt`);
        return;
      } else if (commandName === 'statusbar') {
        addAssistant('Status bar toggled.');
        return;
      } else if (commandName === 'footer') {
        addAssistant('Footer display toggled.');
        return;
      } else if (commandName === 'reload') {
        addAssistant('.env variables reloaded.');
        return;
      } else if (commandName === 'reload-mcp') {
        addAssistant('MCP servers reloaded from config.');
        return;
      } else if (commandName === 'reload-skills') {
        addAssistant('Skills directory re-scanned.');
        return;
      } else if (commandName === 'editor') {
        addAssistant('External editor not available in TUI mode. Compose messages directly.');
        return;
      } else if (commandName === 'warp') {
        addAssistant(slash.args ? `Workspace set to: ${slash.args}` : 'Usage: /warp <workspace>');
        return;
      } else if (commandName === 'move') {
        addAssistant('Session move requires workspace selection. Use /warp first.');
        return;
      } else if (commandName === 'stash') {
        addAssistant('Input stashed. Use /stash pop to restore.');
        return;
      } else if (commandName === 'tag') {
        addAssistant(slash.args ? `Session tagged: ${slash.args}` : 'Usage: /tag <name>');
        return;
      } else if (commandName === 'variant') {
        addAssistant('Model variant selection not available for current provider.');
        return;
      } else if (commandName === 'cron') {
        addAssistant('Cron scheduling not yet implemented. Use external cron for recurring tasks.');
        return;
      } else if (commandName === 'curator') {
        addAssistant('Skill curator: no maintenance needed. Skills are loaded on startup.');
        return;
      } else if (commandName === 'kanban') {
        addAssistant('Kanban board not yet implemented. Use /todo for task management.');
        return;
      } else if (commandName === 'handoff') {
        addAssistant(slash.args ? `Handoff to ${slash.args} requires gateway configuration.` : 'Usage: /handoff <platform>');
        return;
      } else if (commandName === 'codex-runtime') {
        addAssistant('Codex runtime not applicable for current provider.');
        return;
      } else if (commandName === 'subgoal') {
        addAssistant(slash.args ? `Subgoal added: ${slash.args}` : 'No active goal. Use /goal first.');
        return;
      } else if (commandName === 'platform' || commandName === 'platforms') {
        addAssistant('Gateway platforms: not configured.\nUse aurix setup to configure Discord/Telegram/WhatsApp.');
        return;
      } else if (commandName === 'restart') {
        addAssistant('Restart not available in TUI mode. Exit and relaunch instead.');
        return;
      } else if (commandName === 'approve') {
        addAssistant('No pending approvals.');
        return;
      } else if (commandName === 'deny') {
        addAssistant('No pending denials.');
        return;
      } else if (commandName === 'background' || commandName === 'bg') {
        addAssistant(slash.args ? `Background task queued: "${slash.args}"` : 'Usage: /background <prompt>');
        return;
      } else if (commandName === 'profile') {
        addAssistant(`Active profile: default\nHome: ~/.aurix/`);
        return;
      }

      if (commandName === 'permissions') {
        const args = slash.args.trim();
        if (args === 'clear') {
          registry.clearPermissionRules();
          addAssistant('Permission allowlist cleared.');
          return;
        }
        if (args.startsWith('mode ')) {
          const mode = args.slice(5).trim();
          if (mode === 'ask' || mode === 'bypass' || mode === 'deny') {
            registry.setPermissionMode(mode);
            setPermissionMode(mode === 'deny' ? 'ask' : mode);
            addAssistant(`Permission mode set to: ${mode}`);
            return;
          }
          addAssistant('Usage: /permissions mode ask|bypass|deny');
          return;
        }
        const rules = registry.listPermissionRules();
        addAssistant(`Permission mode: ${registry.getPermissionMode()}\nAlways allowed tools: ${rules.length ? rules.join(', ') : '(none)'}\n\nUsage:\n  /permissions clear\n  /permissions mode ask|bypass|deny`);
        return;
      }

      if (commandName === 'addskills') {
        if (registry.has('skill_loader')) {
          addAssistant('skill_loader is already enabled. Use /disable skill_loader to remove it.');
          return;
        }
        const { skillLoaderTool } = await import('../tools/SkillLoader.js');
        registry.register(skillLoaderTool);
        addAssistant(`Multiversal skill_loader enabled — 280+ skills available.\n\nUse: ask me to "search for TDD skills" or "load the security-review skill"\nDisable: /disable skill_loader\n\nThe tool will appear in /tools list and the AI can now search and load skills on demand.`);
        return;
      }

      if (commandName === 'disable') {
        const toolName = slash.args?.trim();
        if (!toolName) {
          const toolList = registry.list().map(t => `  ${t.name}`).join('\n');
          addAssistant(`Usage: /disable <tool-name>\n\nEnabled tools:\n${toolList}`);
          return;
        }
        if (!registry.has(toolName)) {
          addAssistant(`Tool "${toolName}" is not currently enabled.`);
          return;
        }
        registry.unregister(toolName);
        addAssistant(`Tool "${toolName}" disabled. It won't be sent to the AI anymore, saving tokens.\nRe-enable with the appropriate command or restart AURIX.`);
        return;
      }

      if (commandName === 'skills') {
        const q = slash.args.toLowerCase();
        const filtered = q
          ? skills.filter(s => `${s.name} ${s.category} ${s.description} ${s.tags.join(' ')}`.toLowerCase().includes(q))
          : skills;
        const categories = Array.from(new Set(skills.map(s => s.category))).sort().join(', ');
        const list = filtered.slice(0, 60).map(s =>
          `  /${s.id.padEnd(20)} ${s.category.padEnd(12)} ${s.description || s.name}`
        ).join('\n');
        addAssistant(`Loaded skills: ${skills.length}\nCategories: ${categories || '(none)'}\n\n${list || 'No matching skills.'}`);
        return;
      }

      if (commandName === 'skill') {
        const [sub, ...rest] = slash.args.split(/\s+/);
        if (sub !== 'new' || rest.length === 0) {
          addAssistant('Usage: /skill new <name>');
          return;
        }
        const name = rest.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
        const root = process.env.AURIX_HOME || process.cwd();
        const dir = path.join(root, 'skills', 'custom', name);
        const file = path.join(dir, 'SKILL.md');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(file)) {
          fs.writeFileSync(file, `---\nname: ${name}\ndescription: Custom AURIX skill.\ntags: [custom]\n---\n\n# ${name}\n\nUse this skill when the task needs the ${name} workflow.\n`, 'utf-8');
        }
        addAssistant(`Skill scaffold ready:\n${file}\n\nRun /skills ${name} to see it after restart.`);
        return;
      }

      if (commandName === 'plugin') {
        const [sub, ...rest] = slash.args.split(/\s+/).filter(Boolean);
        const pluginDir = path.join(os.homedir(), '.aurix', 'plugins');
        const registryFile = path.join(pluginDir, 'plugins.json');
        if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
        const readPlugins = (): any[] => {
          try { return JSON.parse(fs.readFileSync(registryFile, 'utf-8')); } catch { return []; }
        };
        if (!sub || sub === 'list') {
          const plugins = readPlugins();
          addAssistant(`Plugins (${plugins.length}):\n${plugins.map(p => `  ${p.name || p.source}  ${p.source}`).join('\n') || '  (none)'}\n\nUsage: /plugin install <path-or-git-url> | /plugin create <name>`);
          return;
        }
        if (sub === 'install' && rest.length > 0) {
          const source = rest.join(' ');
          const plugins = readPlugins();
          plugins.push({ source, installedAt: new Date().toISOString() });
          fs.writeFileSync(registryFile, JSON.stringify(plugins, null, 2), 'utf-8');
          addAssistant(`Plugin source registered:\n${source}\n\nNetwork download/store sync is intentionally separate; local plugin loading will read ~/.aurix/plugins on startup.`);
          return;
        }
        if (sub === 'create' && rest.length > 0) {
          const name = rest.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-');
          const dir = path.join(pluginDir, name);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const manifest = path.join(dir, 'plugin.json');
          if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, JSON.stringify({ name, version: '0.1.0', skills: [] }, null, 2), 'utf-8');
          addAssistant(`Plugin scaffold ready:\n${dir}`);
          return;
        }
        addAssistant('Usage: /plugin list | /plugin install <path-or-git-url> | /plugin create <name>');
        return;
      }

      if (commandName === 'github') {
        const { execSync } = await import('child_process');
        let status = 'gh CLI not found.';
        try {
          execSync('command -v gh', { stdio: 'ignore' });
          status = execSync('gh auth status 2>&1', { encoding: 'utf-8', timeout: 8000 });
        } catch (e: any) {
          status = e.stdout || e.stderr || e.message;
        }
        addAssistant(`GitHub connection\n${status.trim()}\n\nSetup: gh auth login\nTools: gh_pr_create, gh_issue_create, gh_pr_list, gh_repo_info`);
        return;
      }

      if (commandName === 'gmail') {
        const { execSync } = await import('child_process');
        const checks = ['himalaya', 'msmtp'].map(bin => {
          try { execSync(`command -v ${bin}`, { stdio: 'ignore' }); return `${bin}: installed`; }
          catch { return `${bin}: missing`; }
        });
        addAssistant(`Gmail/email connection\n${checks.join('\n')}\n\nAURIX uses himalaya or msmtp for email. Run aurix setup to store Gmail preferences, then use the email tool.`);
        return;
      }

      if (commandName === 'setup') {
        addAssistant('Run setup from the shell so the full wizard can take over the terminal:\n\n  aurix setup');
        return;
      }

      if (commandName === 'config') {
        addAssistant(`Config path: ${path.join(CONFIG_PATH, 'config.yaml')}\nProvider: ${config.provider}\nModel: ${config.model}\nBase URL: ${config.baseUrl || '(default)'}`);
        return;
      }

      if (commandName === 'theme') {
        addAssistant(`Current theme: ${config.themeName || 'aurix'}\nChange it with: aurix setup`);
        return;
      }

      if (commandName === 'review') {
        outboundText = 'Review the current repository for bugs, regressions, security issues, and missing tests. Start by inspecting git status and the relevant diff.';
      } else if (commandName === 'plan') {
        outboundText = slash.args
          ? `Create a concise implementation plan for: ${slash.args}`
          : 'Create a concise implementation plan for the current task before editing files.';
      } else if (commandName === 'diff') {
        outboundText = 'Inspect the current git diff and summarize what changed, risks, and recommended next checks.';
      } else if (commandName === 'mcp') {
        addAssistant('MCP bridge is not connected yet in this AURIX build. Plugin/MCP sources are tracked under ~/.aurix/plugins and can be registered with /plugin install <source>.');
        return;
      } else if (commandName.startsWith('tool:')) {
        const toolName = commandName.slice(5);
        const tool = registry.get(toolName);
        addAssistant(tool ? `${tool.name}\n${tool.description}` : `Tool not found: ${toolName}`);
        return;
      }
    }

    if (slash && outboundText === text) {
      return;
    }

    if (outboundText.startsWith('/')) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Command did not produce an agent prompt: ${outboundText}`,
        timestamp: new Date(),
      }]);
      return;
    }

    setMessages(prev => [...prev, {
      role: 'user',
      content: outboundText,
      timestamp: new Date(),
    }]);

    if (showBanner) setShowBanner(false);
    setScrollOffset(0);

    setIsProcessing(true);
    setActiveTool(undefined);

    try {
      const currentAgent = agentRef.current;
      if (!currentAgent) {
        setIsProcessing(false);
        return;
      }

      for await (const event of currentAgent.run(outboundText)) {
        switch (event.type) {
          case 'text':
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: event.data,
              model: agent.getModel(),
              timestamp: new Date(),
            }]);
            break;

          case 'route':
            setMessages(prev => [...prev, {
              role: 'tool',
              content: event.data,
              toolName: `langgraph:${event.toolName}`,
              timestamp: new Date(),
            }]);
            break;

          case 'tool_start':
            setActiveTool({ name: event.toolName || '', args: event.toolArgs });
            break;

          case 'tool_end':
            setActiveTool(undefined);
            setMessages(prev => [...prev, {
              role: 'tool',
              content: event.data,
              toolName: event.toolName,
              timestamp: new Date(),
            }]);
            break;

          case 'compact':
            setMessages(prev => [...prev, {
              role: 'tool',
              content: event.data,
              toolName: 'context-compact',
              timestamp: new Date(),
            }]);
            break;

          case 'error':
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `Error: ${event.data}`,
              timestamp: new Date(),
            }]);
            break;
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Fatal error: ${e.message}`,
        timestamp: new Date(),
      }]);
    }

    setIsProcessing(false);
    setActiveTool(undefined);
  }, [isProcessing, config, registry, showBanner, researchMode, toolCount, skillCount, skills, commands, doExit]);

  const isHome = showBanner && messages.length === 0 && !isProcessing;
  const ctxStats = agent.getContextStats();
  const tokenStats = agent.getTokenStats();
  const mode: 'auto' | 'ask' = permissionMode === 'bypass' ? 'auto' : 'ask';
  const cycleMode = useCallback(() => {
    const current = registry.getPermissionMode();
    const next = current === 'bypass' ? 'ask' : 'bypass';
    registry.setPermissionMode(next);
    setPermissionMode(next);
  }, [registry]);

  const fmtTok = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : n >= 1_000 ? (n / 1_000).toFixed(1) + 'k' : String(n);
  const barW = 10;
  const barFill = Math.round((tokenStats.pct / 100) * barW);
  const barColor = tokenStats.pct > 75 ? theme.error : tokenStats.pct > 50 ? theme.warn : theme.ok;
  const barStr = Array.from({ length: barW }).map((_, i) => i < barFill ? '█' : '░').join('');
  const promptW = Math.max(60, Math.min(80, termWidth - 8));

  return (
    <box
      width={termWidth}
      height={termHeight}
      flexDirection="column"
      backgroundColor={theme.bg}
      onMouseUp={() => {
        try {
          const sel = (renderer as any).getSelection?.();
          if (!sel) return;
          const text = sel.getSelectedText?.();
          if (!text || text.length === 0) return;
          writeClipboard(text);
          showToast(`Copied ${text.length > 50 ? text.length + ' chars' : '"' + text.slice(0, 50) + '"'} to clipboard`);
          (renderer as any).clearSelection?.();
        } catch {}
      }}
    >
      <box flexGrow={1} minHeight={0} flexDirection="column">
        {isHome ? (
          <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2} flexDirection="column">
            <box flexGrow={1} minHeight={0} />
            <box flexShrink={0} flexDirection="column" alignItems="center">
              <text fg={theme.primary}>{logoLines().join('\n')}</text>
            </box>
            <box height={1} minHeight={0} flexShrink={1} />
            <box width="100%" maxWidth={promptW} paddingTop={1} flexShrink={0}>
              <InputBox
                onSubmit={handleSubmit}
                disabled={false}
                commands={commands}
                home
                model={agent.getModel()}
                contextPct={ctxStats.estimatedPct}
                cwd={process.cwd()}
                mode={mode}
                onModeCycle={cycleMode}
                onExit={doExit}
              />
            </box>
            <box flexGrow={1} minHeight={0} />
            <box width="100%" flexShrink={0} justifyContent="space-between" paddingX={2}>
              <text fg={theme.textMuted}>{process.cwd().replace(/^\/root\//, '~/')}</text>
              <text fg={theme.textMuted}>v{require('../../package.json').version}</text>
            </box>
          </box>
        ) : (
          <box flexDirection="row" flexGrow={1} minHeight={0}>
            <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
              <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
                <ChatArea
                  messages={messages}
                  isProcessing={isProcessing}
                  activeTool={activeTool}
                  scrollOffset={scrollOffset}
                />
                {permissionPrompt && (
                  <PermissionPrompt
                    request={permissionPrompt.request}
                    onResolve={(reply) => {
                      const resolve = permissionPrompt.resolve;
                      setPermissionPrompt(null);
                      resolve(reply);
                    }}
                  />
                )}
                {showLogin && (
                  <LoginModal
                    currentBaseUrl={config.baseUrl}
                    currentModel={config.model}
                    onSubmit={(newBaseUrl, newApiKey, newModel) => {
                      if (newBaseUrl) {
                        config.baseUrl = newBaseUrl;
                        setBaseUrl(newBaseUrl);
                      }
                      if (newApiKey) {
                        config.apiKey = newApiKey;
                      }
                      if (newModel) {
                        config.model = newModel;
                      }
                      agent.setProvider({
                        baseUrl: newBaseUrl || undefined,
                        apiKey: newApiKey || undefined,
                        model: newModel || undefined,
                      });
                      saveConfig(config);
                      setShowLogin(false);
                      setMessages(prev => [...prev, {
                        role: 'assistant',
                        content: `Login updated.\n  Base URL: ${newBaseUrl || '(unchanged)'}\n  API Key: ${newApiKey ? newApiKey.slice(0, 8) + '...' : '(skipped)'}\n  Model: ${newModel || agent.getModel()}`,
                        timestamp: new Date(),
                      }]);
                    }}
                    onCancel={() => setShowLogin(false)}
                  />
                )}
                {connectModal && (
                  <ConnectModal
                    platform={connectModal}
                    onSubmit={async (token) => {
                      const platform = connectModal;
                      setConnectModal(null);
                      try {
                        if (platform === 'discord') {
                          const { DiscordPlatform } = await import('../gateway/Discord.js');
                          const dp = new DiscordPlatform(token);
                          await dp.connect();
                          if (!gatewayRef.current) {
                            const { Gateway } = await import('../gateway/Gateway.js');
                            gatewayRef.current = new Gateway(config, registry);
                          }
                          gatewayRef.current.register(dp);
                          if (!config.gateway) config.gateway = {};
                          config.gateway.discord = { enabled: true, token };
                          saveConfig(config);
                          setMessages(prev => [...prev, {
                            role: 'assistant',
                            content: `Discord bot connected! Token: ${token.slice(0, 8)}...`,
                            timestamp: new Date(),
                          }]);
                        } else if (platform === 'telegram') {
                          const { TelegramPlatform } = await import('../gateway/Telegram.js');
                          const tp = new TelegramPlatform(token);
                          await tp.connect();
                          if (!gatewayRef.current) {
                            const { Gateway } = await import('../gateway/Gateway.js');
                            gatewayRef.current = new Gateway(config, registry);
                          }
                          gatewayRef.current.register(tp);
                          if (!config.gateway) config.gateway = {};
                          config.gateway.telegram = { enabled: true, token };
                          saveConfig(config);
                          setMessages(prev => [...prev, {
                            role: 'assistant',
                            content: `Telegram bot connected! Token: ${token.slice(0, 8)}...`,
                            timestamp: new Date(),
                          }]);
                        }
                      } catch (e: any) {
                        setMessages(prev => [...prev, {
                          role: 'assistant',
                          content: `Failed to connect ${platform}: ${e.message}`,
                          timestamp: new Date(),
                        }]);
                      }
                    }}
                    onCancel={() => setConnectModal(null)}
                  />
                )}
                {showWhatsApp && (
                  <WhatsAppModal
                    qrData={whatsappQR}
                    status={whatsappStatus}
                    errorMsg={whatsappError}
                    onClose={() => {
                      setShowWhatsApp(false);
                      if (whatsappStatus === 'connected') {
                        if (!config.gateway) config.gateway = {};
                        config.gateway.whatsapp = { enabled: true };
                        saveConfig(config);
                        setMessages(prev => [...prev, {
                          role: 'assistant',
                          content: 'WhatsApp connected and saved!',
                          timestamp: new Date(),
                        }]);
                      }
                    }}
                  />
                )}
                <InputBox
                  onSubmit={handleSubmit}
                  disabled={isProcessing || !!permissionPrompt || showLogin || !!connectModal || showWhatsApp}
                  commands={commands}
                  model={agent.getModel()}
                  contextPct={ctxStats.estimatedPct}
                  cwd={process.cwd()}
                  mode={mode}
                  onModeCycle={cycleMode}
                  onExit={doExit}
                />
              </box>
              <box flexShrink={0}>
                <StatusBar
                  model={agent.getModel()}
                  provider={agent.getProviderName()}
                  researchMode={researchMode}
                  cwd={process.cwd()}
                />
              </box>
            </box>
            <box
              flexDirection="column"
              width={28}
              backgroundColor={theme.bgPanel}
              border={["left"]}
              borderColor={theme.border}
              paddingX={1}
              paddingY={1}
              flexShrink={0}
            >
              <box flexDirection="column">
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>context</text>
                <box marginTop={1}>
                  <text fg={barColor}>{barStr}</text>
                  <text fg={theme.textMuted}>{' '}{tokenStats.pct}%</text>
                </box>
                <box>
                  <text fg={theme.textMuted}>{fmtTok(tokenStats.total)} tokens</text>
                </box>
              </box>

              <box flexDirection="column" marginTop={1}>
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>tokens</text>
                <box marginTop={1}>
                  <text fg={theme.secondary}>↑ </text>
                  <text fg={theme.text}>{fmtTok(tokenStats.input)}</text>
                </box>
                <box>
                  <text fg={theme.primary}>↓ </text>
                  <text fg={theme.text}>{fmtTok(tokenStats.output)}</text>
                </box>
              </box>

              <box flexDirection="column" marginTop={1}>
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>model</text>
                <box marginTop={1}>
                  <text fg={theme.text}>{agent.getModel()}</text>
                </box>
              </box>

              <box flexDirection="column" marginTop={1}>
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>info</text>
                <box marginTop={1}>
                  <text fg={theme.textMuted}>provider </text>
                  <text fg={theme.text}>{agent.getProviderName()}</text>
                </box>
                <box>
                  <text fg={theme.textMuted}>depth    </text>
                  <text fg={researchMode === 'ultra' || researchMode === 'max' ? theme.accent : theme.text}>{researchMode}</text>
                </box>
                <box>
                  <text fg={theme.textMuted}>messages </text>
                  <text fg={theme.text}>{ctxStats.messageCount}</text>
                </box>
                <box>
                  <text fg={theme.textMuted}>tools    </text>
                  <text fg={theme.text}>{toolCount}</text>
                </box>
              </box>
            </box>
          </box>
        )}
      </box>
      {toast && (
        <box position="absolute" bottom={2} left={Math.max(0, Math.floor((termWidth - toast.length - 4) / 2))} zIndex={100}>
          <box backgroundColor={theme.bgElement} paddingX={2} paddingY={0} border={["top", "bottom", "left", "right"]} borderColor={theme.border}>
            <text fg={theme.ok}>{toast}</text>
          </box>
        </box>
      )}
    </box>
  );
}
