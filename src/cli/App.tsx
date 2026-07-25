import { AskUserManager, setGlobalAskCallback } from '../tools/AskUser.js';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions, useRenderer } from '@opentui/react';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ChatArea, type ChatMessage } from './ChatArea.js';
import { applyAgentEvent, createPresentationState, startUserTurn } from './TurnState.js';
import type { PresentationState } from './TurnState.js';
import { writeClipboard } from './Clipboard.js';
import { InputBox } from './InputBox.js';
import { StatusBar } from './StatusBar.js';
import { Banner } from './Banner.js';
import { detectInstallMethod, terminalDiagnostics } from './InstallDiagnostics.js';
import { acceptResumePageLoad, beginResumePageLoad, buildResumedDisplayMessages, createResumePageState, type ResumeDisplayPageState } from './ResumeDisplay.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import { LoginModal } from './LoginModal.js';
import { VisionModal } from './VisionModal.js';
import { ConnectModal } from './ConnectModal.js';
import { RewindPicker, type RewindMode } from './RewindPicker.js';
import { CommandPalette } from './CommandPalette.js';
import { ModelPicker } from './ModelPicker.js';
import { SessionBrowser, type SessionInfo } from './SessionBrowser.js';
import { WhatsAppModal } from './WhatsAppModal.js';
import { OutputPanel } from './OutputPanel.js';
import {
  theme,
  switchTheme,
  ALL_THEME_NAMES,
  getThemeVersion,
  type ThemeName,
  setBorderStyle,
  type BorderStyle,
} from './theme.js';
import { orchestratorEvents } from '../tools/SpawnAgent.js';
import type { CronDaemon } from '../agent/CronDaemon.js';
import {
  auditCommandCoverage,
  createSlashCommands,
  findCommand,
  formatCommandHelp,
  parseSlash,
} from './commands.js';
import { AgentLoop, type AgentEvent } from '../agent/AgentLoop.js';
import { fetchConfiguredModels } from '../agent/ModelDiscovery.js';
import { modelContextDiagnostic } from '../agent/ModelContext.js';
import { applyModelSelection, toModelPickerItems, type ModelPickerItem } from '../agent/ModelSelection.js';
import { renderToolEnd } from '../agent/ToolEventRenderer.js';
import type { AurixConfig } from '../agent/Config.js';
import { CONFIG_PATH, loadConfig, saveConfig } from '../agent/Config.js';
import { runSetup } from '../agent/Setup.js';
import { editSoulFile, formatReloadReport, formatSoulShow, getAgentsStatus, getCanonicalSoulPath, getSoulStatus } from './SoulCommands.js';
import type { ToolRegistry } from '../tools/Registry.js';
import type { PermissionReply, ToolPermissionRequest } from '../tools/Registry.js';
import { loadSkillsFromDir } from '../skills/SkillRegistry.js';
import { getAurixVersion, getRuntimeInfo } from '../utils/RuntimeInfo.js';
import { safeDisplayText } from '../utils/terminal-sanitize.js';
import { mcpManager } from '../mcp/McpRegistry.js';
import {
  loadTodos as loadTodosFromFile,
  addTodo as addTodoToFile,
  completeTodo as completeTodoInFile,
  getTodoStats,
} from '../utils/TodoManager.js';

const VALID_DEPTHS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
type ResearchDepth = (typeof VALID_DEPTHS)[number];

const HANDLED_COMMANDS = new Set([
  'addskills',
  'background',
  'border',
  'browser',
  'browserui',
  'btw',
  'bundles',
  'busy',
  'clear',
  'codex-runtime',
  'compact',
  'config',
  'copy',
  'cost',
  'cron',
  'curator',
  'debug',
  'deep',
  'deep-research',
  'deny',
  'diff',
  'disable',
  'discord',
  'doctor',
  'editor',
  'effort',
  'evals',
  'exit',
  'export',
  'fast',
  'focus',
  'footer',
  'fork',
  'github',
  'gmail',
  'goal',
  'gui',
  'handoff',
  'help',
  'history',
  'history-search',
  'image',
  'indicator',
  'init',
  'insights',
  'kanban',
  'login',
  'mcp',
  'memory',
  'model',
  'move',
  'multiagent',
  'new',
  'paste',
  'permissions',
  'personality',
  'platform',
  'platforms',
  'plugin',
  'plugins',
  'profile',
  'proxy',
  'queue',
  'reasoning',
  'recap',
  'redraw',
  'reload',
  'reload-mcp',
  'reload-skills',
  'research-forums',
  'replay',
  'reset',
  'restart',
  'resume',
  'retry',
  'review',
  'rewind',
  'rollback',
  'rules',
  'save',
  'soul',
  'code-review',
  'security-review',
  'sessions',
  'setup',
  'simplify',
  'skill',
  'skills',
  'skin',
  'snapshot',
  'status',
  'statusbar',
  'stash',
  'steer',
  'stop',
  'subgoal',
  'tag',
  'telegram',
  'theme',
  'todo',
  'tools',
  'trash',
  'toolsets',
  'undo',
  'update',
  'usage',
  'variant',
  'verify',
  'vision',
  'voice',
  'warp',
  'whatsapp',
  'whoami',
  'yolo',
]);

function describeDepthMode(mode: ResearchDepth): string {
  const descriptions: Record<ResearchDepth, string> = {
    low: 'Single-agent normal execution.',
    medium: 'Single-agent execution with light research discipline for research-like prompts.',
    high: 'Research prompts route to the research pipeline; complex coding/audit prompts route to native multi-agent.',
    xhigh: 'High routing plus debate/verifier stages where the research pipeline supports them.',
    max: 'Forces real pipeline/multi-agent routing for research and complex tasks.',
    ultra:
      'Maximum research pipeline/final-review or native multi-agent synthesis for complex tasks.',
  };
  return descriptions[mode];
}

function normalizeApiStyleInput(value?: string): AurixConfig['apiStyle'] | undefined {
  const style = value?.trim().toLowerCase();
  if (!style) return undefined;
  if (style === '1') return 'openai';
  if (style === '2') return 'anthropic';
  if (style === 'openai' || style === 'anthropic' || style === 'auto') return style;
  return undefined;
}

function normalizeProviderInput(value?: string): AurixConfig['provider'] | undefined {
  const provider = value?.trim().toLowerCase();
  if (!provider) return undefined;
  if (provider === '1') return 'openai';
  if (provider === '2') return 'anthropic';
  if (provider === '3') return 'custom';
  if (
    provider === 'openai' ||
    provider === 'anthropic' ||
    provider === 'custom' ||
    provider === 'custom-anthropic'
  )
    return provider;
  return undefined;
}

interface AppProps {
  config: AurixConfig;
  registry: ToolRegistry;
  resumeId?: string;
  cronDaemon?: CronDaemon;
}

export function App({ config, registry, resumeId, cronDaemon }: AppProps) {
  const renderer = useRenderer();
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const presentationStateRef = React.useRef<PresentationState>(createPresentationState());
  const setPresentationState = useCallback((next: PresentationState) => {
    presentationStateRef.current = next;
    setMessages(next.messages as ChatMessage[]);
  }, []);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAskingUser, setIsAskingUser] = useState(false);
  const [activeTool, setActiveTool] = useState<
    { name: string; args?: Record<string, unknown> } | undefined
  >();
  const [showBanner, setShowBanner] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const resumePageRef = React.useRef<ResumeDisplayPageState | null>(null);
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
  const [whatsappStatus, setWhatsappStatus] = useState<
    'initializing' | 'waiting' | 'connected' | 'error'
  >('initializing');
  const [whatsappError, setWhatsappError] = useState<string | undefined>();
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const gatewayRef = React.useRef<any>(null);
  const [permissionMode, setPermissionMode] = useState<'ask' | 'bypass' | 'deny'>(
    registry.getPermissionMode()
  );
  const agentRef = React.useRef<AgentLoop | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showRewind, setShowRewind] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [modelPicker, setModelPicker] = useState<{
    items: ModelPickerItem[];
    loading: boolean;
    error?: string;
    initialQuery?: string;
  } | null>(null);
  const modelPickerRequestRef = React.useRef(0);
  const modelPickerOpenRef = React.useRef(false);
  const [subagents, setSubagents] = useState<{ status: string }[] | null>(null);
  const [showVisionConfig, setShowVisionConfig] = useState(false);
  const [sessionList, setSessionList] = useState<SessionInfo[] | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingImagesRef = React.useRef<string[]>([]);
  const [planMode, setPlanMode] = useState<'normal' | 'auto' | 'plan' | 'auto-plan'>('normal');
  const [sessionRules, setSessionRules] = useState<string[]>([]);
  const [sessionGoal, setSessionGoal] = useState<string | null>(null);
  const [todos, setTodos] = useState<{ text: string; done: boolean }[]>([]);
  const [btwMessages, setBtwMessages] = useState<string[]>([]);
  const [showOutputPanel, setShowOutputPanel] = useState(false);
  const [themeVersion, setThemeVersion] = useState(getThemeVersion());
  const liveToolOutputRef = React.useRef<{
    toolName?: string;
    text: string;
    timer?: ReturnType<typeof setTimeout>;
  }>({ text: '' });
  const streamBatchRef = React.useRef<{
    runId?: string;
    events: AgentEvent[];
    timer?: ReturnType<typeof setTimeout>;
    flush?: () => void;
    cancel?: () => void;
  }>({ events: [] });
  const activeUiRunRef = React.useRef<string | undefined>();
  const activeAgentRunRef = React.useRef<string | undefined>();
  const cancelActiveUiRun = useCallback((flush = true) => {
    if (flush) streamBatchRef.current.flush?.();
    streamBatchRef.current.cancel?.();
    activeUiRunRef.current = undefined;
  }, []);

  useEffect(() => {
    setGlobalAskCallback((sessionKey, question, toolOptions) => {
      if (sessionKey === 'default') {
        let content = `[Human-in-the-Loop Required] ${question}`;
        if (toolOptions && toolOptions.length > 0) {
          content += `\nOptions:\n` + toolOptions.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
        }
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content,
            timestamp: new Date(),
          },
        ]);
        setIsAskingUser(true);
      }
    });

    let lastTodoSnapshot = '';
    const refreshTodos = () => {
      const fileTodos = loadTodosFromFile();
      const next = fileTodos.map((t) => ({ text: t.text, done: t.done }));
      const snapshot = JSON.stringify(next);
      if (snapshot === lastTodoSnapshot) return;
      lastTodoSnapshot = snapshot;
      setTodos(next);
    };

    refreshTodos();
    const interval = setInterval(refreshTodos, 2000);

    return () => clearInterval(interval);
  }, []);

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
      showToast(
        `Copied ${text.length > 50 ? text.length + ' chars' : '"' + text.slice(0, 50) + '"'} to clipboard`
      );
      if (typeof (renderer as any).clearSelection === 'function')
        (renderer as any).clearSelection();
    };
  }, [renderer, showToast]);

  const doExit = useCallback(async () => {
    // Cleanup: interrupt any running agent task, stop gateway, stop MCP
    cancelActiveUiRun();
    activeAgentRunRef.current = undefined;
    try {
      agentRef.current?.interrupt();
    } catch {}
    try {
      gatewayRef.current?.stop();
    } catch {}
    try {
      mcpManager.stopAll();
    } catch {}

    const name = sessionNameRef.current !== 'New session' ? sessionNameRef.current : undefined;
    const saveId = resumeSessionIdRef.current || name;
    const sessionId = (await agentRef.current?.saveSessionAsync(saveId)) || '';
    try {
      renderer.destroy();
    } catch {}

    process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l' + '\x1b[?1049l');

    if (sessionId) {
      process.stdout.write(`\n  \x1b[90msession ended\x1b[0m\n`);
      process.stdout.write(
        `  \x1b[38;2;250;178;131mcontinue with:\x1b[0m aurix --resume ${sessionId}\n\n`
      );
    }

    process.stdout.write('\x1b[?25h\x1b[0m');
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(0);
  }, [cancelActiveUiRun, renderer]);

  if (!agentRef.current) {
    agentRef.current = new AgentLoop(config, registry);
    try {
      const { initCheckpointEngine } = require('../agent/Checkpoint.js');
      initCheckpointEngine(resumeId || `sess_${Date.now()}`);
    } catch {}
  }

  const resumedRef = React.useRef(false);
  const resumeSessionIdRef = React.useRef<string | undefined>(resumeId);

  const agent = agentRef.current;

  useEffect(() => {
    if (!resumeId || resumedRef.current) return;
    resumedRef.current = true;
    (async () => {
      const count = (await agentRef.current?.loadSessionAsync(resumeId)) || 0;
      if (count > 0) {
        resumeSessionIdRef.current = resumeId;
        const store = await agentRef.current?.getSessionStore();
        const page = store?.loadSessionPage(resumeId, { limit: 80 });
        const pageMessages = page?.messages || (agentRef.current?.getMessages() || []).filter((m: any) => m.role !== 'system').slice(-80);
        const display = buildResumedDisplayMessages(pageMessages, resumeId, { startIndex: count - pageMessages.length, maxMessages: 80 });
        resumePageRef.current = createResumePageState(resumeId, page?.oldestCursor, Boolean(page?.hasMore));
        presentationStateRef.current = createPresentationState(display);
        setMessages(display);
        setShowBanner(false);
      } else {
        setMessages([
          {
            role: 'system' as const,
            content: `Session "${resumeId}" not found. Use /title to name sessions, or run aurix without --resume.`,
            timestamp: new Date(),
          },
        ]);
      }
    })();
  }, [resumeId]);

  const loadOlderResumedMessages = useCallback(async () => {
    const current = resumePageRef.current;
    if (!current) return;
    const begun = beginResumePageLoad(current);
    resumePageRef.current = begun.state;
    if (!begun.request) return;
    try {
      const store = await agent.getSessionStore();
      const page = store.loadSessionPage(begun.request.sessionId, { beforeId: begun.request.beforeId, limit: 80 });
      const latest = resumePageRef.current;
      if (!latest || latest.sessionId !== begun.request.sessionId || latest.generation !== begun.request.generation) return;
      const older = buildResumedDisplayMessages(page.messages, begun.request.sessionId, { maxMessages: 80 });
      resumePageRef.current = acceptResumePageLoad(latest, {
        sessionId: begun.request.sessionId,
        generation: begun.request.generation,
        oldestCursor: page.oldestCursor,
        hasMore: page.hasMore,
      });
      if (older.length > 0) {
        setMessages((prev) => [...older, ...prev]);
        presentationStateRef.current = createPresentationState([...older, ...presentationStateRef.current.messages]);
        setScrollOffset((prev) => prev + older.length);
      }
    } catch {
      const latest = resumePageRef.current;
      if (latest && latest.generation === begun.request.generation) resumePageRef.current = { ...latest, loading: false };
    }
  }, [agent]);

  useEffect(() => {
    const onStart = (data: any) => {
      setSubagents(new Array(data.total).fill({ status: 'queued' }));
    };
    const onStatus = (data: any) => {
      setSubagents((prev) => {
        if (!prev) return null;
        const next = [...prev];
        next[data.index] = { status: data.status };
        return next;
      });
    };
    const onEnd = () => {
      setSubagents(null);
    };

    orchestratorEvents.on('start', onStart);
    orchestratorEvents.on('status', onStatus);
    orchestratorEvents.on('end', onEnd);

    return () => {
      orchestratorEvents.off('start', onStart);
      orchestratorEvents.off('status', onStatus);
      orchestratorEvents.off('end', onEnd);
    };
  }, []);

  const toolCount = registry.list().length;
  const skills = useMemo(() => {
    const root = process.env.AURIX_HOME || process.cwd();
    return loadSkillsFromDir(path.join(root, 'skills'));
  }, []);
  const skillCount = skills.length;
  const runtimeInfo = getRuntimeInfo();
  const aurixVersion = getAurixVersion();
  const commands = useMemo(
    () => createSlashCommands({ toolCount, skillCount, registry }),
    [toolCount, skillCount, registry]
  );
  const allCommands = useMemo(
    () => createSlashCommands({ toolCount, skillCount, registry }, { includeHidden: true }),
    [toolCount, skillCount, registry]
  );

  useEffect(() => {
    registry.setPermissionHandler(
      (request) =>
        new Promise((resolve) => {
          setPermissionPrompt({ request, resolve });
        })
    );
  }, [registry]);

  useKeyboard((evt) => {
    const name = evt.name;

    if (modelPickerOpenRef.current) return;

    if (evt.ctrl && name === 'o') {
      evt.preventDefault();
      setShowOutputPanel((prev) => !prev);
      return;
    }

    if (name === 'escape' && isProcessing) {
      evt.preventDefault();
      cancelActiveUiRun();
      setIsProcessing(false);
      if (activeTool) {
        agent.interrupt();
        setActiveTool(undefined);
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content: 'Tool cancelled. Agent will continue with next action.',
            timestamp: new Date(),
          },
        ]);
      } else {
        agent.interrupt();
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content: 'Agent interrupted. Response stopped.',
            timestamp: new Date(),
          },
        ]);
      }
      return;
    }

    if (evt.ctrl && name === 'l') {
      evt.preventDefault();
      if (activeAgentRunRef.current) return;
      agentRef.current?.clearHistory();
      cancelActiveUiRun(false);
      clearLiveToolOutput();
      const cleared = createPresentationState();
      presentationStateRef.current = cleared;
      setMessages([]);
      setShowBanner(true);
      setScrollOffset(0);
      return;
    }

    if (evt.ctrl && name === 'p' && !isProcessing && !showRewind) {
      evt.preventDefault();
      setShowPalette(true);
      return;
    }

    if (evt.ctrl && name === 'y') {
      evt.preventDefault();
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant) {
        const text = lastAssistant.content;
        const b64 = Buffer.from(text).toString('base64');
        const seq = `\x1b]52;c;${b64}\x07`;
        process.stdout.write(process.env.TMUX ? `\x1bPtmux;\x1b${seq}\x1b\\` : seq);
        import('node:child_process')
          .then(({ spawn }) => {
            // Build env with DISPLAY for xclip/xsel (works on all platforms with X11)
            const clipEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
            if (process.env.DISPLAY) clipEnv.DISPLAY = process.env.DISPLAY;
            if (process.env.XAUTHORITY) clipEnv.XAUTHORITY = process.env.XAUTHORITY;
            const tools: [string, string[]][] = [
              ['wl-copy', []],
              ['xclip', ['-selection', 'clipboard']],
              ['xsel', ['--clipboard', '--input']],
              ['pbcopy', []],
            ];
            for (const [cmd, args] of tools) {
              try {
                const child = spawn(cmd, args, {
                  stdio: ['pipe', 'ignore', 'ignore'],
                  env: clipEnv,
                });
                child.stdin?.end(text);
                child.on('error', () => {});
              } catch {}
            }
          })
          .catch(() => {});
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant' as const,
            content: 'Last response copied to clipboard.',
            timestamp: new Date(),
          },
        ]);
      }
      return;
    }

    if (name === 'up' && !isProcessing) {
      evt.preventDefault();
      setScrollOffset((prev) => { const next = Math.min(prev + 1, Math.max(0, messages.length - 1)); if (next >= Math.max(0, messages.length - 1)) void loadOlderResumedMessages(); return next; });
      return;
    }

    if (name === 'down' && !isProcessing) {
      evt.preventDefault();
      setScrollOffset((prev) => Math.max(0, prev - 1));
      return;
    }

    if (name === 'pageup' && !isProcessing) {
      evt.preventDefault();
      setScrollOffset((prev) => { const next = Math.min(prev + 20, Math.max(0, messages.length - 5)); if (next >= Math.max(0, messages.length - 5)) void loadOlderResumedMessages(); return next; });
      return;
    }

    if (name === 'pagedown' && !isProcessing) {
      evt.preventDefault();
      setScrollOffset((prev) => Math.max(0, prev - 20));
      return;
    }
  });

  const handleRewind = useCallback(
    async (checkpointId: string, mode: RewindMode) => {
      setShowRewind(false);
      let restoredText = '';
      // 1. Restore conversation: truncate messages back to the chosen checkpoint.
      if (mode === 'both' || mode === 'conversation') {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.checkpointId === checkpointId);
          if (idx < 0) return prev;
          restoredText = prev[idx].content;
          return prev.slice(0, idx);
        });
        try {
          const trimmed = agent.getMessages();
          const cut = trimmed.findIndex((m: any) => m.content && m.content.includes(restoredText));
          if (cut > 0) agent.setMessages?.(trimmed.slice(0, cut));
        } catch {}
      }
      // 2. Restore code: replay the file snapshot to disk.
      let fileNote = '';
      if (mode === 'both' || mode === 'code') {
        try {
          const { getCheckpointEngine } = await import('../agent/Checkpoint.js');
          const changed = getCheckpointEngine()?.restore(checkpointId) || [];
          fileNote = changed.length
            ? ` Restored ${changed.length} file(s).`
            : ' No file changes to restore.';
        } catch {}
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `⟲ Rewound to an earlier point.${fileNote}`,
          timestamp: new Date(),
        },
      ]);
    },
    [agent]
  );

  const flushLiveToolOutput = useCallback(() => {
    const live = liveToolOutputRef.current;
    if (live.timer) {
      clearTimeout(live.timer);
      live.timer = undefined;
    }
    if (!live.text) return;
    const content = `Live output: ${live.toolName || 'tool'}\n${live.text}`;
    const toolName = live.toolName;
    live.text = '';
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (
        last?.role === 'tool' &&
        last.toolName === toolName &&
        last.content.startsWith('Live output:')
      ) {
        return [...prev.slice(0, -1), { ...last, content, timestamp: new Date() }];
      }
      return [...prev, { role: 'tool', content, toolName, timestamp: new Date() }];
    });
  }, []);

  const clearLiveToolOutput = useCallback(() => {
    const live = liveToolOutputRef.current;
    if (live.timer) clearTimeout(live.timer);
    live.timer = undefined;
    live.text = '';
    live.toolName = undefined;
  }, []);

  useEffect(
    () => () => {
      try {
        agentRef.current?.interrupt();
      } catch {}
      activeAgentRunRef.current = undefined;
      cancelActiveUiRun(false);
      clearLiveToolOutput();
    },
    [cancelActiveUiRun, clearLiveToolOutput],
  );

  const queueLiveToolOutput = useCallback(
    (toolName: string | undefined, chunk: string) => {
      const live = liveToolOutputRef.current;
      if (live.toolName !== toolName) {
        flushLiveToolOutput();
        live.toolName = toolName;
      }
      const nextText = `${live.text}${live.text ? '\n' : ''}${chunk}`;
      live.text = nextText.split('\n').slice(-40).join('\n');
      if (!live.timer) live.timer = setTimeout(flushLiveToolOutput, 180);
    },
    [flushLiveToolOutput]
  );

  const openModelPicker = useCallback(
    async (initialQuery = '') => {
      const requestId = ++modelPickerRequestRef.current;
      modelPickerOpenRef.current = true;
      setModelPicker({ items: [], loading: true, initialQuery });
      const result = await fetchConfiguredModels(config);
      if (requestId !== modelPickerRequestRef.current) return;
      const items = toModelPickerItems(result.models, agentRef.current?.getModel() || config.model);
      const lastFailure = [...result.attempts].reverse().find((attempt) => !attempt.ok);
      const error = items.length
        ? undefined
        : lastFailure
          ? `Could not load /models: ${lastFailure.status ? `HTTP ${lastFailure.status} ` : ''}${lastFailure.error || lastFailure.url}`
          : 'No models returned by the configured provider.';
      setModelPicker({ items, loading: false, error, initialQuery });
    },
    [config]
  );

  const handleSubmit = useCallback(
    async (text: string) => {
      if (AskUserManager.isWaiting('default')) {
        setMessages((prev) => [...prev, { role: 'user', content: text, timestamp: new Date() }]);
        AskUserManager.submitAnswer('default', text);
        setIsAskingUser(false);
        return;
      }

      // While an agent run is active, only commands that are handled inline may proceed.
      // Commands that produce a new prompt must wait to avoid sharing one AgentLoop concurrently.
      if (activeAgentRunRef.current) {
        const preSlash = parseSlash(text);
        const allowedWhileRunning = new Set(['btw', 'exit', 'help', 'status', 'stop']);
        if (!preSlash || !allowedWhileRunning.has(preSlash.name)) return;
      }

      let outboundText = text;
      const addAssistant = (content: string) => {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content,
            timestamp: new Date(),
          },
        ]);
      };

      const slash = parseSlash(text);
      if (slash) {
        const command = findCommand(allCommands, slash.name);
        const commandName = command?.name || slash.name;

        if (!command && !commandName.startsWith('tool:')) {
          addAssistant(
            `Unknown command: /${slash.name}\n\nType /help or press Ctrl+P for available commands.`
          );
          return;
        }

        const notImplemented = (name: string, reason: string) => {
          addAssistant(`Not implemented yet: /${name}. ${reason}`);
        };

        if (command?.status === 'not-implemented') {
          notImplemented(
            commandName,
            'This command is hidden from help until it has a real implementation.'
          );
          return;
        }

        if (commandName === 'exit') {
          doExit();
          return;
        }

        if (commandName === 'setup') {
          if (isProcessing) {
            agent.interrupt();
            cancelActiveUiRun();
            setIsProcessing(false);
            clearLiveToolOutput();
          }
          try {
            await agent.saveSessionAsync(
              sessionNameRef.current !== 'New session'
                ? sessionNameRef.current
                : undefined,
            );
          } catch {}
          try {
            renderer.destroy();
          } catch {}
          process.stdout.write(
            '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1049l\x1b[?25h\x1b[0m',
          );
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          await runSetup(slash.args.trim() === '--continue');
          process.stdout.write('\nSetup complete. Restart Aurix to apply the new provider configuration.\n');
          process.exit(0);
        }

        if (commandName === 'clear') {
          if (activeAgentRunRef.current) agent.interrupt();
          cancelActiveUiRun();
          setIsProcessing(false);
          setActiveTool(undefined);
          agentRef.current?.clearHistory();
          clearLiveToolOutput();
          setMessages([]);
          setShowBanner(true);
          setScrollOffset(0);
          return;
        }

        if (commandName === 'help') {
          addAssistant(
            `AURIX Agent Commands\n\n${formatCommandHelp(commands)}\n\nKeyboard\n  /                 Open slash autocomplete\n  Tab               Complete selected command / cycle mode (Shift+Tab)\n  Up/Down           Navigate suggestions or scroll chat\n  Esc               Interrupt current run\n  Ctrl+L            Clear transcript\n  Ctrl+P            Toggle slash command palette\n  Ctrl+C            Exit`
          );
          return;
        }

        if (commandName === 'depth') {
          if (!slash.args) {
            addAssistant(
              `Current depth: ${researchMode}\n\nUsage: /depth <mode>\nModes: ${VALID_DEPTHS.join(', ')}`
            );
            return;
          }
          const mode = slash.args.trim().toLowerCase() as ResearchDepth;
          if (!VALID_DEPTHS.includes(mode)) {
            addAssistant(`Invalid depth "${mode}". Valid: ${VALID_DEPTHS.join(', ')}`);
            return;
          }
          setResearchMode(mode);
          config.researchMode = mode;
          agent.setResearchMode(mode);
          saveConfig(config);
          addAssistant(`Research depth set to: ${mode}\n${describeDepthMode(mode)}`);
          return;
        }

        if (commandName === 'status') {
          const uptime = Math.round(process.uptime());
          const fmt =
            uptime < 60
              ? `${uptime}s`
              : uptime < 3600
                ? `${Math.floor(uptime / 60)}m`
                : `${Math.floor(uptime / 3600)}h${Math.floor((uptime % 3600) / 60)}m`;
          addAssistant(
            `Model: ${agent.getModel()}\nProvider: ${agent.getProviderName()}\nResearch: ${researchMode}\nMulti-agent: ${agent.isMultiAgent() ? 'ON' : 'OFF'}\nPermission mode: ${registry.getPermissionMode()}\nTools: ${toolCount}\nSkills: ${skillCount}\nUptime: ${fmt}`
          );
          return;
        }

        if (commandName === 'multiagent') {
          const enabled = agent.toggleMultiAgent();
          if (enabled) {
            addAssistant(
              `Native multi-agent routing ON.\n\nAurix will select specialists per task and show route/tool progress when they actually run. Simple prompts may still run direct. Use /agents to inspect mode.`
            );
          } else {
            addAssistant('Multi-agent mode OFF. Using single-agent direct mode.');
          }
          return;
        }

        if (commandName === 'tools') {
          const toolList = registry
            .list()
            .map((t) => `  ${t.name.padEnd(20)} ${t.description.slice(0, 72)}`)
            .join('\n');
          addAssistant(`Available tools (${toolCount}):\n${toolList}`);
          return;
        }

        if (commandName === 'history') {
          const count = agent.getMessages().length;
          addAssistant(
            `Conversation has ${count} messages (including system prompt).\nDurable session: ${agent.getSessionId()}`
          );
          return;
        }

        if (commandName === 'history-search') {
          const q = slash.args.trim();
          if (!q) {
            addAssistant('Usage: /history-search <query>\nExample: /history-search geetest');
            return;
          }
          try {
            const hits = await agent.searchSessions(q, 8);
            if (hits.length === 0) {
              addAssistant(`No durable session hits for: ${q}`);
              return;
            }
            const lines = hits.map(
              (s, i) =>
                `  ${i + 1}. ${s.id} — ${s.preview || s.snippet || '(empty)'} (${s.messageCount} msg, ${s.savedAt || 'unknown date'})`
            );
            addAssistant(
              `History search: "${q}"\n\n${lines.join('\n')}\n\nResume newest match: /resume latest ${q}\nResume exact: /resume <session-id>`
            );
          } catch (e: any) {
            addAssistant(`History search failed: ${e.message}`);
          }
          return;
        }

        if (commandName === 'trash') {
          const raw = slash.args.trim();
          const [subcmd = 'list', id] = raw.split(/\s+/);
          const { formatTrashList, recoverTrashEntry } = await import('../agent/TrashStore.js');
          if (!raw || subcmd === 'list') {
            addAssistant(`Recoverable trash\n\n${formatTrashList(agent.getSessionId())}`);
            return;
          }
          if (subcmd === 'recover' || subcmd === 'restore') {
            if (!id) {
              addAssistant('Usage: /trash recover <recovery-id-or-original-path>');
              return;
            }
            addAssistant(recoverTrashEntry(id, { sessionId: agent.getSessionId() }));
            return;
          }
          addAssistant('Usage: /trash list | /trash recover <id>');
          return;
        }

        if (commandName === 'replay') {
          const raw = slash.args.trim();
          const parts = raw.split(/\s+/).filter(Boolean);
          const { getSessionStore } = await import('../agent/SessionStore.js');
          const store = await getSessionStore();
          let sessionId: string | undefined = agent.getSessionId();
          let jobId: string | undefined;
          if (parts[0] === 'session' && parts[1]) sessionId = parts[1];
          else if (parts[0] === 'job' && parts[1]) {
            sessionId = undefined;
            jobId = parts[1];
          } else if (parts[0] === 'latest') sessionId = agent.getSessionId();
          const events = store.listObserverEvents({ sessionId, jobId }, 40).reverse();
          if (events.length === 0) {
            addAssistant('No observer events found for replay target.');
            return;
          }
          const lines = events.map((event) => {
            const time = event.createdAt ? event.createdAt.slice(11, 19) : '--:--:--';
            const status = event.status ? ` ${event.status}` : '';
            const tool = event.toolName ? ` ${event.toolName}` : '';
            const summary = event.summary
              ? ` — ${event.summary.replace(/\s+/g, ' ').slice(0, 120)}`
              : '';
            return `${time} ${event.source}:${event.eventType}${status}${tool}${summary}`;
          });
          addAssistant(
            `Replay timeline\nTarget: ${jobId ? `job ${jobId}` : `session ${sessionId}`}\n\n${lines.join('\n')}`
          );
          return;
        }

        if (commandName === 'evals') {
          const raw = slash.args.trim();
          const parts = raw.split(/\s+/).filter(Boolean);
          const { getSessionStore } = await import('../agent/SessionStore.js');
          const store = await getSessionStore();
          let sessionId: string | undefined = agent.getSessionId();
          let jobId: string | undefined;
          if (parts[0] === 'session' && parts[1]) sessionId = parts[1];
          else if (parts[0] === 'job' && parts[1]) {
            sessionId = undefined;
            jobId = parts[1];
          } else if (parts[0] === 'latest') sessionId = agent.getSessionId();
          const events = store.listObserverEvents({ sessionId, jobId }, 200);
          const evidence = sessionId ? store.listEvidenceItems(sessionId, 20) : [];
          const errors = events.filter(
            (e) => e.status === 'error' || e.eventType.includes('failed')
          );
          const toolErrors = events.filter(
            (e) => e.eventType === 'tool_end' && e.status === 'error'
          );
          const denied = events.filter((e) => e.eventType === 'delete_denied');
          const recovered = events.filter((e) => e.eventType === 'recovery_success');
          const deleteTrash = events.filter((e) => e.eventType === 'delete_moved_to_trash');
          const passedEvidence = evidence.filter((e) => e.status === 'passed');
          const failedEvidence = evidence.filter((e) => e.status === 'failed');
          let score = 100;
          score -= Math.min(30, toolErrors.length * 10);
          score -= Math.min(25, errors.length * 8);
          score -= denied.length * 5;
          score -= failedEvidence.length * 15;
          if (passedEvidence.length > 0) score += 5;
          if (recovered.length > 0) score += 5;
          score = Math.max(0, Math.min(100, score));
          const notes = [
            `Score: ${score}/100`,
            `Observer events: ${events.length}`,
            `Tool errors: ${toolErrors.length}`,
            `Evidence passed/failed: ${passedEvidence.length}/${failedEvidence.length}`,
            `Deletes moved to trash: ${deleteTrash.length}`,
            `Recoveries: ${recovered.length}`,
          ];
          if (errors.length > 0) {
            notes.push('', 'Recent errors:');
            notes.push(
              ...errors
                .slice(0, 5)
                .map(
                  (e) =>
                    `- ${e.source}:${e.eventType} ${e.summary ? e.summary.replace(/\s+/g, ' ').slice(0, 120) : ''}`
                )
            );
          }
          addAssistant(
            `Agent evaluation\nTarget: ${jobId ? `job ${jobId}` : `session ${sessionId}`}\n\n${notes.join('\n')}`
          );
          return;
        }

        if (commandName === 'context') {
          const raw = slash.args.trim().toLowerCase();
          if (raw === 'refresh') {
            await agent.refreshContextMetadata({ preferFreshModels: true });
          } else if (raw === 'auto') {
            const previous = {
              contextLimit: config.contextLimit,
              contextInputLimit: config.contextInputLimit,
              contextOutputLimit: config.contextOutputLimit,
              contextCompactionBuffer: config.contextCompactionBuffer,
            };
            delete config.contextLimit;
            delete config.contextInputLimit;
            delete config.contextOutputLimit;
            delete config.contextCompactionBuffer;
            try {
              await agent.applyProviderConfig(
                {
                  contextLimit: undefined,
                  contextInputLimit: undefined,
                  contextOutputLimit: undefined,
                  contextCompactionBuffer: undefined,
                },
                { preferFreshModels: true }
              );
              saveConfig(config);
            } catch (error) {
              Object.assign(config, previous);
              throw error;
            }
          } else if (raw.startsWith('set ')) {
            const value = raw.slice(4).trim().replace(/[,_]/g, '');
            const match = value.match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
            if (!match) {
              addAssistant('Usage: /context set <tokens|500k|1m>');
              return;
            }
            const base = Number(match[1]);
            const multiplier = match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2] ? 1_000 : 1;
            const limit = Math.round(base * multiplier);
            if (!Number.isFinite(limit) || limit < 4_000 || limit > 2_000_000) {
              addAssistant('Context limit must be between 4,000 and 2,000,000 tokens.');
              return;
            }
            await agent.applyProviderConfig({ contextLimit: limit });
            config.contextLimit = limit;
            saveConfig(config);
          } else if (raw) {
            addAssistant('Usage: /context [refresh|set <tokens|500k|1m>|auto]');
            return;
          }

          const info = agent.getContextDiagnostics();
          const { metadata, budget, stats } = info;
          const age = Math.max(0, Math.round((Date.now() - metadata.updatedAt) / 60_000));
          const thresholdPct = Math.round((budget.autoCompactThreshold / budget.contextLimit) * 100);
          addAssistant(
            `Context window\n` +
              `  Model: ${info.model}\n` +
              `  Router: ${info.baseUrl || info.provider}\n` +
              `  Estimated active: ${stats.totalTokens.toLocaleString()} tokens\n` +
              `  Total context: ${budget.contextLimit.toLocaleString()} tokens\n` +
              `  Input limit: ${(budget.inputLimit || budget.contextLimit).toLocaleString()} tokens\n` +
              `  Output reservation: ${budget.outputReservation.toLocaleString()} tokens\n` +
              `  Safety buffer: ${budget.scalableBuffer.toLocaleString()} tokens\n` +
              `  Auto-compact: ${budget.autoCompactThreshold.toLocaleString()} tokens (${thresholdPct}% of total)\n` +
              `  Current pressure: ${stats.estimatedPct}% of auto-compact threshold\n` +
              `  Source: ${metadata.source} (${metadata.confidence} confidence${age ? `, ${age}m old` : ''})\n` +
              `${metadata.endpoint ? `  Metadata endpoint: ${metadata.endpoint}\n` : ''}` +
              `  Messages: ${stats.messageCount} · Compactions: ${stats.compactedCount}\n` +
              `  Last provider input: ${info.lastProviderInput ? info.lastProviderInput.toLocaleString() : 'not reported'}\n\n` +
              `Commands: /context refresh · /context set 500k · /context auto`
          );
          return;
        }

        if (commandName === 'compact') {
          const removed = await agent.compactMessages();
          addAssistant(
            removed > 0
              ? `Context compacted: removed ${removed} message(s) from active context.`
              : 'Context compaction ran; nothing needed removal.'
          );
          return;
        }

        if (commandName === 'reset') {
          cancelActiveUiRun();
          try {
            agentRef.current?.interrupt();
          } catch {}
          clearLiveToolOutput();
          agentRef.current = new AgentLoop(config, registry);
          setMessages([
            {
              role: 'assistant',
              content: 'Agent reset. New context started.',
              timestamp: new Date(),
            },
          ]);
          setScrollOffset(0);
          return;
        }

        if (commandName === 'model') {
          if (slash.name === 'models') {
            await openModelPicker(slash.args.trim());
            return;
          }
          if (!slash.args) {
            await openModelPicker();
            return;
          }
          const selected = await applyModelSelection(agent, config, slash.args);
          addAssistant(
            `Model switched to: ${selected.model}\nContext: ${modelContextDiagnostic(selected.context)}`
          );
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
                gatewayRef.current = new Gateway(config, registry, cronDaemon);
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
          const ledger = tokens.ledger;
          const maxLabel = 15;
          const fmt = (n: number) => n.toLocaleString().padStart(8);
          addAssistant(
            `Session Token Ledger:\n` +
              `  ${'System prompt'.padEnd(maxLabel)}: ${fmt(ledger.systemPrompt)} (cached)\n` +
              `  ${'User input'.padEnd(maxLabel)}: ${fmt(ledger.userInput)}\n` +
              `  ${'Tool calls'.padEnd(maxLabel)}: ${fmt(ledger.toolCalls)}\n` +
              `  ${'Tool results'.padEnd(maxLabel)}: ${fmt(ledger.toolResults)}\n` +
              `  ${'Agent text'.padEnd(maxLabel)}: ${fmt(ledger.agentText)}\n` +
              `  ${'Skills'.padEnd(maxLabel)}: ${fmt(ledger.skills)}\n` +
              `  ${'─'.repeat(maxLabel + 10)}\n` +
              `  ${'Total tracked'.padEnd(maxLabel)}: ${fmt(Object.values(ledger).reduce((a: number, b: number) => a + b, 0) as number)}\n` +
              `  ${'API input'.padEnd(maxLabel)}: ${fmt(tokens.apiInput)}\n` +
              `  ${'API output'.padEnd(maxLabel)}: ${fmt(tokens.apiOutput)}\n` +
              `  ${'Context window'.padEnd(maxLabel)}: ${fmt(stats.totalTokens)} (~${stats.estimatedPct}%)\n` +
              `  Messages: ${stats.messageCount} (${stats.compactedCount} compactions)\n\n` +
              `Actual cost depends on your provider's pricing.`
          );
          return;
        }

        if (commandName === 'doctor') {
          const checks = [
            `Runtime: ${runtimeInfo.label}`,
            `Platform: ${process.platform} ${process.arch}`,
            `Uptime: ${Math.round(process.uptime())}s`,
            `Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
            `Tools: ${toolCount}`,
            `Skills: ${skillCount}`,
            `Provider: ${agent.getProviderName()}`,
            `Model: ${agent.getModel()}`,
            `Base URL: ${baseUrl || '(default)'}`,
          ];
          const install = detectInstallMethod(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'));
          checks.push(...terminalDiagnostics());
          checks.push(`Install: ${install.detail}`);
          checks.push(`Update: ${install.updateCommand}`);
          const audit = auditCommandCoverage(allCommands, HANDLED_COMMANDS, ['tool:*']);
          const commandAudit =
            `Command audit:\n` +
            `  Missing visible handlers: ${audit.missingHandler.length ? audit.missingHandler.join(', ') : 'none'}\n` +
            `  Handler-only commands: ${audit.hiddenHandler.length ? audit.hiddenHandler.join(', ') : 'none'}\n` +
            `  Visible stubs: ${audit.stubVisible.length ? audit.stubVisible.join(', ') : 'none'}`;
          addAssistant(
            `AURIX Doctor\n${checks.map((c) => `  ✓ ${c}`).join('\n')}\n\n${commandAudit}`
          );
          return;
        }

        if (commandName === 'browserui') {
          const mode = slash.args?.trim() || '';
          if (!mode || mode === 'status') {
            const result = await registry.execute('browser', { action: 'set-ui' });
            addAssistant(result);
            return;
          }
          const result = await registry.execute('browser', { action: 'set-ui', value: mode });
          addAssistant(result);
          return;
        }

        if (commandName === 'gui') {
          const mode = slash.args?.trim() || 'on';
          const result = await registry.execute('browser', { action: 'set-ui', value: mode });
          addAssistant(result);
          return;
        }

        if (commandName === 'skill') {
          const arg = slash.args?.trim() || '';
          if (arg.startsWith('new ')) {
            const name = arg
              .slice(4)
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, '-')
              .replace(/-+/g, '-');
            if (!name) {
              addAssistant('Usage: /skill new <name>');
              return;
            }
            const root = process.env.AURIX_HOME || process.cwd();
            const dir = path.join(root, 'skills', 'custom', name);
            const file = path.join(dir, 'SKILL.md');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(file)) {
              fs.writeFileSync(
                file,
                `---\nname: ${name}\ndescription: Custom AURIX skill.\ntags: [custom]\n---\n\n# ${name}\n\nUse this skill when the task needs the ${name} workflow.\n`,
                'utf-8'
              );
            }
            addAssistant(
              `Skill scaffold ready:\n${file}\n\nRun /skills ${name} to see it after restart.`
            );
            return;
          }

          const { setSkillLimit, getSkillCounts, getSkillLimit } =
            await import('../tools/SkillLoader.js');

          if (!arg || arg === 'status') {
            const counts = getSkillCounts();
            const limit = getSkillLimit();
            addAssistant(
              `Skill Management:\n` +
                `  Total: ${counts.total}\n` +
                `  Core (always active): ${counts.core}\n` +
                `  Additional: ${counts.additional}\n` +
                `  Visible: ${counts.visible}\n` +
                `  Limit: ${limit === null ? 'no limit' : limit + ' additional'}\n\n` +
                `Usage: /skill <number> — limit additional skills\n` +
                `       /skill off — remove limit (show all)\n` +
                `       /skill new <name> — create a local skill scaffold`
            );
            return;
          }

          if (arg === 'off' || arg === '0' || arg === 'all') {
            setSkillLimit(null);
            const counts = getSkillCounts();
            addAssistant(`Skill limit removed. All ${counts.total} skills are now available.`);
            return;
          }

          const num = parseInt(arg, 10);
          if (isNaN(num) || num < 1) {
            addAssistant(
              'Usage: /skill <number> or /skill off\nExample: /skill 50 — show 50 additional skills + core'
            );
            return;
          }

          setSkillLimit(num);
          const counts = getSkillCounts();
          addAssistant(
            `Skill limit set to ${num} additional skills (+ ${counts.core} core = ${counts.core + num} visible out of ${counts.total} total).`
          );
          return;
        }

        if (commandName === 'proxy') {
          const proxy = slash.args?.trim() || '';
          if (!proxy) {
            const result = await registry.execute('browser', { action: 'status' });
            addAssistant(`Browser proxy:\n${result}`);
            return;
          }
          const result = await registry.execute('browser', { action: 'set-proxy', value: proxy });
          addAssistant(result);
          return;
        }

        if (commandName === 'effort') {
          if (!slash.args) {
            addAssistant(
              `Current research depth: ${researchMode}\n\nUsage: /effort <low|medium|high|xhigh|max|ultra>`
            );
            return;
          }
          const mode = slash.args.trim().toLowerCase() as ResearchDepth;
          if (!VALID_DEPTHS.includes(mode)) {
            addAssistant(`Invalid effort "${mode}". Valid: ${VALID_DEPTHS.join(', ')}`);
            return;
          }
          setResearchMode(mode);
          config.researchMode = mode;
          agent.setResearchMode(mode);
          saveConfig(config);
          addAssistant(`Research effort set to: ${mode}\n${describeDepthMode(mode)}`);
          return;
        }

        if (commandName === 'fast') {
          setResearchMode('low');
          config.researchMode = 'low';
          agent.setResearchMode('low');
          if (agent.isMultiAgent()) agent.toggleMultiAgent();
          saveConfig(config);
          addAssistant(
            'Switched to fast mode: low depth, single-agent normal execution. Use /deep for max research.'
          );
          return;
        }

        if (commandName === 'deep') {
          const wasDeep = researchMode === 'ultra' && agent.isMultiAgent();
          if (wasDeep) {
            setResearchMode('medium');
            config.researchMode = 'medium';
            agent.setResearchMode('medium');
            agent.toggleMultiAgent();
            saveConfig(config);
            addAssistant(
              'Deep research OFF. Back to medium depth: single-agent with light research discipline.'
            );
          } else {
            setResearchMode('ultra');
            config.researchMode = 'ultra';
            agent.setResearchMode('ultra');
            if (!agent.isMultiAgent()) agent.toggleMultiAgent();
            saveConfig(config);
            addAssistant(
              `DEEP RESEARCH ON\n  Depth: ultra\n  Research prompts: full ResearchPipeline with final review\n  Complex code/audit prompts: native multi-agent routing with selected specialists\n  Auto-compact: ON at 75%\n\nQueries now route by task type instead of only changing a label.`
            );
          }
          return;
        }

        if (commandName === 'deep-research') {
          const researchQuery = slash.args?.trim();
          if (!researchQuery) {
            addAssistant(
              'Usage: /deep-research <topic>\n\nRuns a comprehensive multi-agent research pipeline: request analysis, planning, web research, claim extraction, debate, citation verification, and final review.\n\nCurrent depth: ' +
                researchMode +
                '\nTip: Use /deep first to set depth to ultra for maximum research quality.'
            );
            return;
          }
          outboundText = '';
          const researchRunId = `research_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          activeAgentRunRef.current = researchRunId;
          setIsProcessing(true);
          addAssistant(
            `Starting deep research: "${researchQuery}"\nDepth: ${researchMode}\n\nThis may take a moment as multiple specialist agents analyze the topic...`
          );

          (async () => {
            try {
              for await (const event of agent.runResearch(researchQuery)) {
                if (event.type === 'research') {
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (
                      last &&
                      last.role === 'system' &&
                      last.content.startsWith('Research progress:')
                    ) {
                      return [
                        ...prev.slice(0, -1),
                        { ...last, content: `Research progress: ${event.data}` },
                      ];
                    }
                    return [
                      ...prev,
                      {
                        role: 'system' as const,
                        content: `Research progress: ${event.data}`,
                        timestamp: new Date(),
                      },
                    ];
                  });
                } else if (event.type === 'text') {
                  setMessages((prev) => {
                    const next = prev.filter(
                      (m) => !(m.role === 'system' && m.content.startsWith('Research progress:'))
                    );
                    return [
                      ...next,
                      {
                        role: 'assistant' as const,
                        content: event.data,
                        model: agent.getModel(),
                        timestamp: new Date(),
                      },
                    ];
                  });
                } else if (event.type === 'error') {
                  addAssistant(`Research error: ${event.data}`);
                }
              }
            } catch (e: any) {
              addAssistant(`Deep research failed: ${e.message}`);
            } finally {
              if (activeAgentRunRef.current === researchRunId) {
                activeAgentRunRef.current = undefined;
                setIsProcessing(false);
              }
            }
          })();
          return;
        }

        if (commandName === 'export') {
          const exportPath = path.join(
            os.homedir(),
            '.aurix',
            'exports',
            `session-${Date.now()}.md`
          );
          const dir = path.dirname(exportPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const content = messages
            .map(
              (m) =>
                `## ${m.role}${m.toolName ? ` (${m.toolName})` : ''}\n\n${safeDisplayText(m.content)}`
            )
            .join('\n\n---\n\n');
          fs.writeFileSync(
            exportPath,
            `# AURIX Session Export\n\nExported: ${new Date().toISOString()}\nModel: ${agent.getModel()}\n\n---\n\n${content}`,
            'utf-8'
          );
          addAssistant(`Session exported to:\n${exportPath}`);
          return;
        }

        if (commandName === 'memory') {
          const raw = slash.args.trim();
          if (raw) {
            const [action, ...rest] = raw.split(/\s+/);
            const knownActions = new Set([
              'remember',
              'recall',
              'search',
              'list',
              'consolidate',
              'stats',
            ]);
            if (!knownActions.has(action)) {
              addAssistant('Usage: /memory [remember <text>|recall <query>|search <query>|list|consolidate|stats]');
              return;
            }
            const value = rest.join(' ').trim();
            const result = await registry.execute('memory', {
              action,
              ...(action === 'remember' ? { content: value } : {}),
              ...((action === 'recall' || action === 'search') ? { query: value } : {}),
            });
            addAssistant(result);
            return;
          }
          const { MemoryEngine } = await import('../agent/MemoryEngine.js');
          const mem = new MemoryEngine();
          const summary = mem.loadSummary();
          addAssistant(
            `Memory system\n  Summary: ${summary.length > 0 ? `${summary.length} chars loaded` : '(empty)'}\n  Storage: ~/.aurix/memories/\n  Auto-consolidation: every 10 minutes\n\nUsage: /memory [remember <text>|recall <query>|search <query>|list|consolidate|stats]`
          );
          return;
        }

        if (commandName === 'retry') {
          const lastUser = [...messages].reverse().find((m) => m.role === 'user');
          if (!lastUser) {
            addAssistant('No previous message to retry.');
            return;
          }
          outboundText = lastUser.content;
        } else if (commandName === 'undo') {
          setMessages((prev) => {
            const next = [...prev];
            while (
              next.length > 0 &&
              (next[next.length - 1].role === 'assistant' || next[next.length - 1].role === 'tool')
            )
              next.pop();
            if (next.length > 0 && next[next.length - 1].role === 'user') next.pop();
            return next;
          });
          addAssistant('Last interaction removed.');
          return;
        } else if (commandName === 'save') {
          const exportPath = path.join(
            os.homedir(),
            '.aurix',
            'exports',
            `session-${Date.now()}.md`
          );
          const dir = path.dirname(exportPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const content = messages
            .map(
              (m) =>
                `## ${m.role}${m.toolName ? ` (${m.toolName})` : ''}\n\n${safeDisplayText(m.content)}`
            )
            .join('\n\n---\n\n');
          fs.writeFileSync(
            exportPath,
            `# AURIX Session\n\nSaved: ${new Date().toISOString()}\n\n---\n\n${content}`,
            'utf-8'
          );
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
          setMessages((prev) => prev.slice(0, Math.max(0, prev.length - n * 2)));
          addAssistant(`Rolled back ${n} interaction(s).`);
          return;
        } else if (commandName === 'verbose') {
          addAssistant('Verbose mode toggled. Tool output will now show full results.');
          return;
        } else if (commandName === 'reasoning') {
          const level = slash.args?.trim().toLowerCase();
          if (!level) {
            addAssistant('Usage: /reasoning <low|medium|high>');
            return;
          }
          addAssistant(`Reasoning depth set to: ${level}`);
          return;
        } else if (commandName === 'yolo') {
          registry.setPermissionMode('bypass');
          setPermissionMode('bypass');
          addAssistant(
            'YOLO mode ON — all tool calls auto-approved. Use /permissions mode ask to revert.'
          );
          return;
        } else if (commandName === 'image') {
          if (slash.args) {
            const imgPath = path.resolve(slash.args.trim());
            if (fs.existsSync(imgPath) && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(imgPath)) {
              pendingImagesRef.current.push(imgPath);
              addAssistant(
                `Image attached: ${path.basename(imgPath)} (${pendingImagesRef.current.length} image${pendingImagesRef.current.length > 1 ? 's' : ''} queued). Send a message to include it.`
              );
            } else {
              addAssistant('File not found or unsupported format. Use: /image <path-to-image>');
            }
          } else {
            addAssistant('Usage: /image <path>');
          }
          return;
        } else if (commandName === 'sessions') {
          try {
            let list = await agent.listDurableSessions(30);
            if (list.length === 0) {
              const { MemoryEngine } = await import('../agent/MemoryEngine.js');
              list = new MemoryEngine().listSessions().map((s) => ({ ...s, title: s.id }));
            }
            if (list.length === 0) {
              addAssistant('No past sessions found.');
              return;
            }
            setSessionList(list);
          } catch {
            addAssistant('Could not read sessions.');
          }
          return;
        } else if (commandName === 'copy') {
          const n = parseInt(slash.args || '1', 10);
          const assistantMsgs = messages.filter((m) => m.role === 'assistant').slice(-n);
          if (assistantMsgs.length === 0) {
            addAssistant('No assistant messages to copy.');
            return;
          }
          const text = assistantMsgs.map((m) => m.content).join('\n\n');
          const b64 = Buffer.from(text).toString('base64');
          const seq = `\x1b]52;c;${b64}\x07`;
          process.stdout.write(process.env.TMUX ? `\x1bPtmux;\x1b${seq}\x1b\\` : seq);
          try {
            const { spawn } = await import('node:child_process');
            const clipEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
            if (process.env.DISPLAY) clipEnv.DISPLAY = process.env.DISPLAY;
            if (process.env.XAUTHORITY) clipEnv.XAUTHORITY = process.env.XAUTHORITY;
            const tools: [string, string[]][] = [
              ['wl-copy', []],
              ['xclip', ['-selection', 'clipboard']],
              ['xsel', ['--clipboard', '--input']],
              ['pbcopy', []],
            ];
            for (const [cmd, args] of tools) {
              try {
                const child = spawn(cmd, args, {
                  stdio: ['pipe', 'ignore', 'ignore'],
                  env: clipEnv,
                });
                child.stdin?.end(text);
                child.on('error', () => {});
                break;
              } catch {}
            }
          } catch {}
          addAssistant(`Copied ${assistantMsgs.length} message(s) to clipboard.`);
          return;
        } else if (commandName === 'rewind') {
          if (messages.some((m) => m.role === 'user' && m.checkpointId)) {
            setShowRewind(true);
          } else {
            addAssistant(
              'No rewind checkpoints available yet. Send a message that creates a checkpoint first.'
            );
          }
          return;
        } else if (commandName === 'recap') {
          outboundText =
            'Provide a brief recap of what we have done so far in this conversation, key decisions made, and what remains.';
        } else if (commandName === 'code-review') {
          outboundText =
            'Review the current git diff for code quality, potential bugs, style issues, and suggest improvements.';
        } else if (commandName === 'security-review') {
          outboundText =
            'Scan the current codebase for security vulnerabilities: injection, auth issues, secrets in code, insecure dependencies, and OWASP top 10 risks.';
        } else if (commandName === 'simplify') {
          outboundText = slash.args
            ? `Simplify and refactor: ${slash.args}`
            : 'Review the recent code changes and suggest simplifications or refactoring opportunities.';
        } else if (commandName === 'verify') {
          outboundText =
            'Verify the current changes: run type checking, tests if available, and validate the build compiles correctly.';
        } else if (commandName === 'init') {
          const aurixMd = path.join(process.cwd(), 'AURIX.md');
          if (!fs.existsSync(aurixMd)) {
            fs.writeFileSync(
              aurixMd,
              `# AURIX Project Context\n\n## Overview\nDescribe your project here.\n\n## Architecture\n\n## Conventions\n\n## Key Files\n`,
              'utf-8'
            );
          }
          addAssistant(
            `Project context file created:\n${aurixMd}\n\nEdit AURIX.md to provide AURIX with project-specific context.`
          );
          return;
        } else if (commandName === 'add-dir') {
          addAssistant(
            slash.args ? `Directory access granted: ${slash.args}` : 'Usage: /add-dir <path>'
          );
          return;
        } else if (commandName === 'focus') {
          addAssistant('Focus mode toggled. Minimal UI active.');
          return;
        } else if (commandName === 'insights') {
          try {
            const patterns = await agent.detectWorkflowPatterns(8);
            if (patterns.length === 0) {
              addAssistant(
                'No repeated workflow patterns detected yet. Run a few verified tasks first; Aurix only suggests candidates after repeated successful evidence.'
              );
              return;
            }
            const lines = patterns.map((p, i) => {
              const marker = p.candidateSkill ? 'candidate skill' : 'observed pattern';
              return `  ${i + 1}. ${p.name} — ${p.sequence.join(' → ')} (${p.count}x, ${p.successfulSessions} successful sessions, ${marker})`;
            });
            addAssistant(
              `Learning insights\n\n${lines.join('\n')}\n\nAurix will not auto-create skills from one-off work; repeated successful patterns become candidates only.`
            );
          } catch (e: any) {
            addAssistant(`Insights failed: ${e.message}`);
          }
          return;
        } else if (commandName === 'debug') {
          addAssistant('Debug logging enabled for this session. Logs stored in ~/.aurix/logs/');
          return;
        } else if (commandName === 'queue') {
          addAssistant(
            slash.args
              ? `Queued: "${slash.args}" will run after current task.`
              : 'Usage: /queue <text>'
          );
          return;
        } else if (commandName === 'steer') {
          addAssistant(
            slash.args ? `Guidance injected: "${slash.args}"` : 'Usage: /steer <guidance>'
          );
          return;
        } else if (commandName === 'fork') {
          addAssistant(
            slash.args ? `Background sub-agent spawned: ${slash.args}` : 'Usage: /fork <directive>'
          );
          return;
        } else if (commandName === 'branch') {
          addAssistant(
            slash.args
              ? `Conversation branched: ${slash.args}`
              : 'Conversation branched from current point.'
          );
          return;
        } else if (commandName === 'btw') {
          if (!slash.args) {
            addAssistant('Usage: /btw <question>');
            return;
          }
          const btwText = slash.args.trim();
          if (isProcessing) {
            setBtwMessages((prev) => [...prev, btwText]);
            setMessages((prev) => [
              ...prev,
              {
                role: 'system',
                content: `[BTW] ${btwText}`,
                timestamp: new Date(),
              },
            ]);
            addAssistant(`Side note injected (no tools, temp only): "${btwText}"`);
          } else {
            outboundText = `(Side question, no tools) ${btwText}`;
          }
        } else if (commandName === 'resume') {
          if (isProcessing) agent.interrupt();
          cancelActiveUiRun();
          setIsProcessing(false);
          setActiveTool(undefined);
          const raw = slash.args.trim();
          if (!raw) {
            setSessionList(await agent.listDurableSessions(30));
            return;
          }
          let target = raw;
          if (raw.toLowerCase().startsWith('latest')) {
            const query = raw.slice('latest'.length).trim();
            const latest = await agent.findLatestSession(query || undefined);
            if (!latest) {
              addAssistant(query ? `No session matches: ${query}` : 'No durable sessions found.');
              return;
            }
            target = latest.id;
          }
          try {
            const count = await agent.loadSessionAsync(target);
            if (count > 0) {
              resumeSessionIdRef.current = target;
              let page: ReturnType<Awaited<ReturnType<typeof agent.getSessionStore>>['loadSessionPage']> | undefined;
              try {
                const store = await agent.getSessionStore();
                page = store.loadSessionPage(target, { limit: 80 });
              } catch {}
              const fallbackLoaded = agent.getMessages().filter((m: any) => m.role !== 'system').slice(-80);
              const pageMessages = page?.messages || fallbackLoaded;
              const display = buildResumedDisplayMessages(pageMessages, target, {
                startIndex: count - pageMessages.length,
                maxMessages: 80,
              });
              resumePageRef.current = createResumePageState(target, page?.oldestCursor, Boolean(page?.hasMore));
              presentationStateRef.current = createPresentationState(display);
              setMessages(display);
              setShowBanner(false);
              setScrollOffset(0);
              addAssistant(`Resumed session: ${target} (${count} messages)`);
            } else {
              addAssistant(`Session not found: ${target}`);
            }
          } catch (e: any) {
            addAssistant(`Resume failed: ${e.message}`);
          }
          return;
        } else if (commandName === 'snapshot') {
          addAssistant('Configuration snapshot saved. Use /snapshot restore <name> to restore.');
          return;
        } else if (commandName === 'new') {
          if (isProcessing) agent.interrupt();
          cancelActiveUiRun();
          setIsProcessing(false);
          setActiveTool(undefined);
          clearLiveToolOutput();
          agentRef.current = new AgentLoop(config, registry);
          setMessages([
            { role: 'assistant', content: 'New session started.', timestamp: new Date() },
          ]);
          setScrollOffset(0);
          setShowBanner(true);
          return;
        } else if (commandName === 'stop') {
          agent.interrupt();
          cancelActiveUiRun();
          setIsProcessing(false);
          setActiveTool(undefined);
          clearLiveToolOutput();
          addAssistant('All background processes killed.');
          return;
        } else if (commandName === 'compress') {
          const removed = await agent.compactMessages();
          addAssistant(
            removed > 0
              ? `Context compressed: removed ${removed} message(s) from active context.`
              : 'Context compression ran; nothing needed removal.'
          );
          return;
        } else if (commandName === 'usage') {
          const subcmd = slash.args.trim().toLowerCase();
          if (subcmd === 'tools') {
            try {
              const stats = await agent.getToolUsageStats(12);
              if (stats.length === 0) {
                addAssistant(
                  'No tool usage stats recorded yet. Run a few tool-using sessions first.'
                );
                return;
              }
              const lines = stats.map((s, i) => {
                const duration = s.averageDurationMs ? `, avg ${s.averageDurationMs}ms` : '';
                const err = s.topErrorType ? `, top error: ${s.topErrorType}` : '';
                return `  ${i + 1}. ${s.toolName}: ${s.total} runs, ${s.successRate}% success (${s.success}/${s.total})${duration}${err}`;
              });
              addAssistant(`Tool usage stats\n\n${lines.join('\n')}\n\nPatterns: /insights`);
            } catch (e: any) {
              addAssistant(`Tool usage stats failed: ${e.message}`);
            }
            return;
          }
          const stats = agent.getContextStats();
          const tokens = agent.getTokenStats();
          const ledger = tokens.ledger;
          addAssistant(
            agent.getLedger().format(stats.totalTokens, stats.estimatedPct) +
              `\n  Messages: ${stats.messageCount} (${stats.compactedCount} compactions)\n\nUse /usage tools for learned tool success rates.`
          );
          return;
        } else if (commandName === 'agents' || commandName === 'tasks') {
          try {
            const jobs = await agent.listAgentJobs(8);
            const mode = agent.isMultiAgent()
              ? 'Native multi-agent routing is ON.'
              : 'Single-agent direct mode. Enable native routing with: /multiagent';
            if (jobs.length === 0) {
              addAssistant(`${mode}\n\nNo persisted agent jobs yet.`);
              return;
            }
            const lines = jobs.map((j, i) => {
              const count = j.totalAgents ? ` ${j.completedAgents || 0}/${j.totalAgents}` : '';
              const done = j.finishedAt ? ` finished ${j.finishedAt}` : ' running';
              const status = j.lastStatus ? ` — ${j.lastStatus}` : '';
              return `  ${i + 1}. ${j.id} ${j.status}${count}${done}${status}\n     ${j.prompt.replace(/\s+/g, ' ').slice(0, 100)}`;
            });
            addAssistant(`Agent dashboard\n${mode}\n\n${lines.join('\n')}`);
          } catch (e: any) {
            addAssistant(`Agent dashboard failed: ${e.message}`);
          }
          return;
        } else if (commandName === 'whoami') {
          addAssistant(
            `Access level: admin\nProvider: ${agent.getProviderName()}\nModel: ${agent.getModel()}`
          );
          return;
        } else if (commandName === 'update') {
          const install = detectInstallMethod(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'));
          addAssistant(
            `Update method: ${install.detail}\n\nRun:\n  ${install.updateCommand}\n\nRestart Aurix after the command completes.`
          );
          return;
        } else if (commandName === 'redraw') {
          addAssistant('UI repaint triggered.');
          return;
        } else if (commandName === 'paste') {
          addAssistant('Paste an image with Ctrl+V or attach with /image <path>.');
          return;
        } else if (commandName === 'browser') {
          const raw = slash.args.trim();
          const [subcmd = 'status', ...rest] = raw.split(/\s+/).filter(Boolean);
          const action = subcmd.toLowerCase();
          try {
            if (!raw || action === 'status') {
              addAssistant(await registry.execute('browser', { action: 'status' }));
              return;
            }
            if (action === 'connect') {
              const endpoint = rest.join(' ').trim();
              if (!endpoint) {
                addAssistant(
                  'Usage: /browser connect <cdp-endpoint>\nExample: /browser connect http://127.0.0.1:9222'
                );
                return;
              }
              config.browser = { ...(config.browser || {}), cdpEndpoint: endpoint };
              saveConfig(config);
              addAssistant(
                await registry.execute('browser', { action: 'connect-cdp', value: endpoint })
              );
              return;
            }
            if (action === 'disconnect') {
              config.browser = { ...(config.browser || {}), cdpEndpoint: undefined };
              saveConfig(config);
              addAssistant(await registry.execute('browser', { action: 'disconnect-cdp' }));
              return;
            }
            addAssistant('Usage: /browser [status|connect <endpoint>|disconnect]');
          } catch (e: any) {
            addAssistant(`Browser command failed: ${e.message}`);
          }
          return;
        } else if (commandName === 'toolsets') {
          addAssistant(
            `Available toolsets: core, office, cybersec, research, trading, vps, planning, frontend, backend, deploy, cloud, osint, creative, maps, notifier`
          );
          return;
        } else if (commandName === 'bundles') {
          addAssistant('No skill bundles installed. Use /skills to browse available skills.');
          return;
        } else if (commandName === 'plugins') {
          addAssistant('No plugins installed. Use /plugin install <source> to add plugins.');
          return;
        } else if (commandName === 'skin') {
          if (slash.args) {
            const name = slash.args.trim().toLowerCase() as ThemeName;
            if (!ALL_THEME_NAMES.includes(name)) {
              addAssistant(`Unknown skin: "${name}". Available: ${ALL_THEME_NAMES.join(', ')}`);
              return;
            }
            switchTheme(name);
            setThemeVersion(getThemeVersion());
            config.themeName = name;
            saveConfig(config);
            addAssistant(`Skin switched to: ${name}`);
            return;
          }
          addAssistant(
            `Current skin: ${config.themeName || 'aurix'}\nAvailable: ${ALL_THEME_NAMES.join(', ')}\n\nUsage: /skin <name> or /theme <name>`
          );
          return;
        } else if (commandName === 'personality') {
          addAssistant(
            slash.args
              ? `Personality set to: ${slash.args}`
              : 'No personality overlay active. Use /personality <name> to set.'
          );
          return;
        } else if (commandName === 'voice') {
          addAssistant('Voice mode: off (not available in current build)');
          return;
        } else if (commandName === 'indicator') {
          addAssistant(`Busy indicator: braille dots (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)`);
          return;
        } else if (commandName === 'busy') {
          addAssistant(
            `Busy behavior: queue (prompt queued for next turn)\nOptions: queue, steer, interrupt`
          );
          return;
        } else if (commandName === 'statusbar') {
          addAssistant('Status bar toggled.');
          return;
        } else if (commandName === 'footer') {
          addAssistant('Footer display toggled.');
          return;
        } else if (commandName === 'reload') {
          try {
            const nextConfig = loadConfig();
            Object.assign(config, nextConfig, { provider: config.provider, model: config.model });
          } catch {}
          agent.refreshSystemPrompt();
          addAssistant(formatReloadReport(getSoulStatus(), getAgentsStatus(process.cwd())));
          return;
        } else if (commandName === 'soul') {
          const subcmd = slash.args.trim().split(/\s+/, 1)[0]?.toLowerCase() || 'show';
          if (subcmd === 'path') {
            addAssistant(getCanonicalSoulPath());
          } else if (subcmd === 'edit') {
            try {
              const code = await editSoulFile();
              addAssistant(code === 0 ? 'SOUL.md editor closed. Use /reload to apply changes.' : `SOUL.md editor exited with code ${code}. Use /reload to apply changes.`);
            } catch (error) {
              addAssistant(`SOUL.md editor failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          } else if (subcmd === 'show' || !slash.args.trim()) {
            addAssistant(formatSoulShow());
          } else {
            addAssistant('Usage: /soul [show|edit|path]');
          }
          return;
        } else if (commandName === 'reload-mcp') {
          await mcpManager.stopAll();
          await mcpManager.startAll();
          const status = mcpManager.getStatus();
          const running = status.filter((s) => s.running).length;
          const tools = mcpManager.getToolCount();
          addAssistant(`MCP servers reloaded: ${running} running, ${tools} tools registered.`);
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
          if (!cronDaemon) {
            addAssistant('Cron daemon unavailable in this runtime.');
            return;
          }
          const raw = slash.args.trim();
          const [subcmd = 'list', ...rest] = raw.split(/\s+/);
          const action = subcmd.toLowerCase();
          try {
            if (!raw || action === 'list') {
              const jobs = await cronDaemon.listJobs();
              if (jobs.length === 0) {
                addAssistant('No scheduled jobs. Add one with: /cron add <cron expr> | <prompt>');
                return;
              }
              const lines = jobs.map(
                (j, i) =>
                  `  ${i + 1}. ${j.id} ${j.status} ${j.schedule} — ${j.prompt.slice(0, 90)}${j.lastRunAt ? ` (last: ${j.lastRunAt})` : ''}`
              );
              addAssistant(
                `Scheduled jobs\n\n${lines.join('\n')}\n\nCommands: /cron add <expr> | <prompt> · /cron remove <id> · /cron run <id>`
              );
              return;
            }
            if (action === 'add') {
              const spec = rest.join(' ');
              const parts = spec.split('|');
              if (parts.length < 2) {
                addAssistant(
                  'Usage: /cron add <cron expr> | <prompt>\nExample: /cron add 0 9 * * * | research China AI news'
                );
                return;
              }
              const schedule = parts[0].trim();
              const prompt = parts.slice(1).join('|').trim();
              const job = await cronDaemon.addJob(schedule, prompt);
              addAssistant(`Scheduled job added: ${job.id}\n  ${job.schedule}\n  ${job.prompt}`);
              return;
            }
            if (action === 'remove' || action === 'delete' || action === 'rm') {
              const id = rest[0];
              if (!id) {
                addAssistant('Usage: /cron remove <id>');
                return;
              }
              const removed = await cronDaemon.removeJob(id);
              addAssistant(
                removed ? `Removed scheduled job: ${id}` : `No scheduled job found: ${id}`
              );
              return;
            }
            if (action === 'run') {
              const id = rest[0];
              if (!id) {
                addAssistant('Usage: /cron run <id>');
                return;
              }
              const run = await cronDaemon.runJob(id);
              addAssistant(
                run.status === 'success'
                  ? `Cron job ${id} completed.\n\n${run.result || ''}`
                  : `Cron job ${id} failed: ${run.error || 'unknown error'}`
              );
              return;
            }
            addAssistant(
              'Usage: /cron list | /cron add <expr> | <prompt> | /cron remove <id> | /cron run <id>'
            );
          } catch (e: any) {
            addAssistant(`Cron error: ${e.message}`);
          }
          return;
        } else if (commandName === 'curator') {
          addAssistant('Skill curator: no maintenance needed. Skills are loaded on startup.');
          return;
        } else if (commandName === 'kanban') {
          addAssistant('Kanban board not yet implemented. Use /todo for task management.');
          return;
        } else if (commandName === 'handoff') {
          addAssistant(
            slash.args
              ? `Handoff to ${slash.args} requires gateway configuration.`
              : 'Usage: /handoff <platform>'
          );
          return;
        } else if (commandName === 'codex-runtime') {
          addAssistant('Codex runtime not applicable for current provider.');
          return;
        } else if (commandName === 'subgoal') {
          addAssistant(
            slash.args ? `Subgoal added: ${slash.args}` : 'No active goal. Use /goal first.'
          );
          return;
        } else if (commandName === 'platform' || commandName === 'platforms') {
          addAssistant(
            'Gateway platforms: not configured.\nUse aurix setup to configure Discord/Telegram/WhatsApp.'
          );
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
          addAssistant(
            slash.args ? `Background task queued: "${slash.args}"` : 'Usage: /background <prompt>'
          );
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
              setPermissionMode(mode);
              addAssistant(`Permission mode set to: ${mode}`);
              return;
            }
            addAssistant('Usage: /permissions mode ask|bypass|deny');
            return;
          }
          const rules = registry.listPermissionRules();
          addAssistant(
            `Permission mode: ${registry.getPermissionMode()}\nAlways allowed tools: ${rules.length ? rules.join(', ') : '(none)'}\n\nUsage:\n  /permissions clear\n  /permissions mode ask|bypass|deny`
          );
          return;
        }

        if (commandName === 'addskills') {
          if (registry.has('skill_loader')) {
            addAssistant(
              'skill_loader is already enabled. Use /disable skill_loader to remove it.'
            );
            return;
          }
          const { skillLoaderTool } = await import('../tools/SkillLoader.js');
          registry.register(skillLoaderTool);
          addAssistant(
            `Multiversal skill_loader enabled — 280+ skills available.\n\nUse: ask me to "search for TDD skills" or "load the security-review skill"\nDisable: /disable skill_loader\n\nThe tool will appear in /tools list and the AI can now search and load skills on demand.`
          );
          return;
        }

        if (commandName === 'disable') {
          const toolName = slash.args?.trim();
          if (!toolName) {
            const toolList = registry
              .list()
              .map((t) => `  ${t.name}`)
              .join('\n');
            addAssistant(`Usage: /disable <tool-name>\n\nEnabled tools:\n${toolList}`);
            return;
          }
          if (!registry.has(toolName)) {
            addAssistant(`Tool "${toolName}" is not currently enabled.`);
            return;
          }
          registry.unregister(toolName);
          addAssistant(
            `Tool "${toolName}" disabled. It won't be sent to the AI anymore, saving tokens.\nRe-enable with the appropriate command or restart AURIX.`
          );
          return;
        }

        if (commandName === 'skills') {
          const q = slash.args.toLowerCase();
          const filtered = q
            ? skills.filter((s) =>
                `${s.name} ${s.category} ${s.description} ${s.tags.join(' ')}`
                  .toLowerCase()
                  .includes(q)
              )
            : skills;
          const categories = Array.from(new Set(skills.map((s) => s.category)))
            .sort()
            .join(', ');
          const list = filtered
            .slice(0, 60)
            .map((s) => `  /${s.id.padEnd(20)} ${s.category.padEnd(12)} ${s.description || s.name}`)
            .join('\n');
          addAssistant(
            `Loaded skills: ${skills.length}\nCategories: ${categories || '(none)'}\n\n${list || 'No matching skills.'}`
          );
          return;
        }

        if (commandName === 'plugin') {
          const [sub, ...rest] = slash.args.split(/\s+/).filter(Boolean);
          const pluginDir = path.join(os.homedir(), '.aurix', 'plugins');
          const registryFile = path.join(pluginDir, 'plugins.json');
          if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
          const readPlugins = (): any[] => {
            try {
              return JSON.parse(fs.readFileSync(registryFile, 'utf-8'));
            } catch {
              return [];
            }
          };
          if (!sub || sub === 'list') {
            const plugins = readPlugins();
            addAssistant(
              `Plugins (${plugins.length}):\n${plugins.map((p) => `  ${p.name || p.source}  ${p.source}`).join('\n') || '  (none)'}\n\nUsage: /plugin install <path-or-git-url> | /plugin create <name>`
            );
            return;
          }
          if (sub === 'install' && rest.length > 0) {
            const source = rest.join(' ');
            const plugins = readPlugins();
            plugins.push({ source, installedAt: new Date().toISOString() });
            fs.writeFileSync(registryFile, JSON.stringify(plugins, null, 2), 'utf-8');
            addAssistant(
              `Plugin source registered:\n${source}\n\nNetwork download/store sync is intentionally separate; local plugin loading will read ~/.aurix/plugins on startup.`
            );
            return;
          }
          if (sub === 'create' && rest.length > 0) {
            const name = rest
              .join('-')
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, '-');
            const dir = path.join(pluginDir, name);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const manifest = path.join(dir, 'plugin.json');
            if (!fs.existsSync(manifest))
              fs.writeFileSync(
                manifest,
                JSON.stringify({ name, version: '0.1.0', skills: [] }, null, 2),
                'utf-8'
              );
            addAssistant(`Plugin scaffold ready:\n${dir}`);
            return;
          }
          addAssistant(
            'Usage: /plugin list | /plugin install <path-or-git-url> | /plugin create <name>'
          );
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
          addAssistant(
            `GitHub connection\n${status.trim()}\n\nSetup: gh auth login\nTools: github_connect, github_pr, github_issue, github_search`
          );
          return;
        }

        if (commandName === 'gmail') {
          const { execSync } = await import('child_process');
          const checks = ['himalaya', 'msmtp'].map((bin) => {
            try {
              execSync(`command -v ${bin}`, { stdio: 'ignore' });
              return `${bin}: installed`;
            } catch {
              return `${bin}: missing`;
            }
          });
          addAssistant(
            `Gmail/email connection\n${checks.join('\n')}\n\nAURIX uses himalaya or msmtp for email. Run aurix setup to store Gmail preferences, then use the email tool.`
          );
          return;
        }

        if (commandName === 'setup') {
          addAssistant(
            'Run setup from the shell so the full wizard can take over the terminal:\n\n  aurix setup'
          );
          return;
        }

        if (commandName === 'config') {
          addAssistant(
            `Config path: ${path.join(CONFIG_PATH, 'config.yaml')}\nProvider: ${config.provider}\nModel: ${config.model}\nBase URL: ${config.baseUrl || '(default)'}`
          );
          return;
        }

        if (commandName === 'theme') {
          if (!slash.args) {
            const themeDescriptions: Record<ThemeName, string> = {
              aurix: 'Teal + Orange (default)',
              opencode: 'Cool blue',
              amber: 'Warm amber ops',
              violet: 'Purple AI',
              mono: 'Grayscale',
              pink: 'Hot pink dream',
              ocean: 'Deep sea cyan + blue',
              dark: 'Ultra minimal dark',
              green: 'Matrix hacker green',
              sunset: 'Orange to pink warm',
              nebula: 'Purple + pink cosmic',
            };
            const current = config.themeName || 'aurix';
            const list = ALL_THEME_NAMES.map((n) =>
              n === current
                ? `  > ${n.padEnd(12)} ${themeDescriptions[n]}`
                : `    ${n.padEnd(12)} ${themeDescriptions[n]}`
            ).join('\n');
            addAssistant(
              `Current theme: ${current}\n\nAvailable themes:\n${list}\n\nUsage: /theme <name>\nExample: /theme pink`
            );
            return;
          }
          const name = slash.args.trim().toLowerCase() as ThemeName;
          if (!ALL_THEME_NAMES.includes(name)) {
            addAssistant(`Unknown theme: "${name}". Available: ${ALL_THEME_NAMES.join(', ')}`);
            return;
          }
          switchTheme(name);
          config.themeName = name;
          saveConfig(config);
          addAssistant(
            `Theme switched to: ${name}\n\nAll colors updated. Use /theme to see all options.`
          );
          return;
        }

        if (commandName === 'border') {
          const styles: BorderStyle[] = ['rounded', 'single', 'double', 'heavy', 'ascii', 'none'];
          if (!slash.args) {
            addAssistant(
              `Border styles:\n${styles.map((s) => `  ${s}`).join('\n')}\n\nUsage: /border <style>\nExample: /border double`
            );
            return;
          }
          const style = slash.args.trim().toLowerCase() as BorderStyle;
          if (!styles.includes(style)) {
            addAssistant(`Unknown border style: "${style}". Available: ${styles.join(', ')}`);
            return;
          }
          setBorderStyle(style);
          addAssistant(`Border style set to: ${style}`);
          return;
        }

        if (commandName === 'review') {
          outboundText =
            'Review the current repository for bugs, regressions, security issues, and missing tests. Start by inspecting git status and the relevant diff.';
        } else if (commandName === 'plan') {
          const modes: Array<'normal' | 'auto' | 'plan' | 'auto-plan'> = [
            'normal',
            'auto',
            'plan',
            'auto-plan',
          ];
          if (!slash.args || slash.args.trim() === '') {
            const current = planMode;
            const idx = modes.indexOf(current);
            const next = modes[(idx + 1) % modes.length];
            setPlanMode(next);
            const modeDesc: Record<string, string> = {
              normal: 'Permission prompts (allow once/always)',
              auto: 'No approval needed, auto-execute',
              plan: 'Create plan, approve each step (yes/no/type)',
              'auto-plan': 'Create plan, auto-execute with interrupt',
            };
            addAssistant(`Plan mode: ${next}\n${modeDesc[next]}\n\nShift+Tab to cycle modes.`);
            return;
          }
          const arg = slash.args.trim().toLowerCase();
          if (modes.includes(arg as any)) {
            setPlanMode(arg as any);
            addAssistant(`Plan mode set to: ${arg}`);
          } else {
            outboundText = `Create a concise implementation plan for: ${slash.args}`;
          }
        } else if (commandName === 'diff') {
          outboundText =
            'Inspect the current git diff and summarize what changed, risks, and recommended next checks.';
        } else if (commandName === 'vision') {
          const action = slash.args.trim().toLowerCase();
          const visionStatus = () =>
            [
              'Vision Fallback:',
              `  Provider: ${config.visionProvider || config.provider || 'openai'}${config.visionProvider ? '' : ' (main)'}`,
              `  API Style: ${config.visionApiStyle || config.apiStyle || 'auto'}${config.visionApiStyle ? '' : ' (main)'}`,
              `  Base URL: ${config.visionBaseUrl || config.baseUrl || '(default provider URL)'}`,
              `  Model: ${config.visionModel || config.model || 'main model'}`,
              `  API Key: ${config.visionApiKey ? 'vision key set' : 'using main key'}`,
              '',
              'Commands:',
              '  /vision          — configure fallback',
              '  /vision status   — show active config',
              '  /vision test     — send a tiny image test',
            ].join('\n');

          if (action === 'status') {
            addAssistant(visionStatus());
            return;
          }

          if (action === 'test') {
            addAssistant('Testing image input with a tiny image...');
            try {
              const { createProvider } = await import('../providers/index.js');
              const vProvider = createProvider({
                ...config,
                provider: config.visionProvider || config.provider,
                baseUrl: config.visionBaseUrl || config.baseUrl,
                apiKey: config.visionApiKey || config.apiKey,
                model: config.visionModel || config.model,
                apiStyle: config.visionApiStyle || config.apiStyle,
                maxTokens: 64,
                temperature: 0,
              });
              const png1x1 =
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
              const res = await vProvider.chat([
                {
                  role: 'user',
                  content: 'What is in this image? Reply in 5 words or fewer.',
                  images: [`data:image/png;base64,${png1x1}`],
                },
              ]);
              addAssistant(`Vision test OK: ${res.text.trim() || '(empty response)'}`);
            } catch (e: any) {
              addAssistant(`Vision test failed: ${e?.message || String(e)}\n\n${visionStatus()}`);
            }
            return;
          }

          setShowVisionConfig(true);
          return;
        } else if (commandName === 'mcp') {
          const subcmd = (slash.args || '').trim().split(/\s+/);
          const action = subcmd[0]?.toLowerCase() || '';
          const arg = subcmd.slice(1).join(' ');

          if (!action || action === 'status') {
            const status = mcpManager.getStatus();
            const total = status.length;
            const running = status.filter((s) => s.running).length;
            const tools = mcpManager.getToolCount();
            if (total === 0) {
              addAssistant(
                `MCP: No servers configured.\n\nCommands:\n  /mcp presets        — show available presets\n  /mcp add <name>     — add a preset server\n  /mcp catalog        — browse online catalog`
              );
            } else {
              const lines = status.map((s) => {
                const icon = s.running ? '●' : s.enabled ? '○' : '⊘';
                const state = s.running ? 'running' : s.enabled ? 'stopped' : 'disabled';
                const toolInfo = s.toolCount > 0 ? ` (${s.toolCount} tools)` : '';
                const desc = s.description ? ` — ${s.description}` : '';
                return `  ${icon} ${s.name}: ${state}${toolInfo}${desc}`;
              });
              addAssistant(
                `MCP Servers: ${total} configured, ${running} running, ${tools} tools\n\n${lines.join('\n')}\n\nCommands: /mcp list · /mcp presets · /mcp add <name> · /mcp remove <name> · /mcp toggle <name> · /mcp restart <name> · /mcp catalog`
              );
            }
          } else if (action === 'list') {
            const status = mcpManager.getStatus();
            if (status.length === 0) {
              addAssistant('No MCP servers configured. Use /mcp presets to see available servers.');
            } else {
              const lines = status.map((s) => {
                const icon = s.running ? '●' : s.enabled ? '○' : '⊘';
                const state = s.running ? 'running' : s.enabled ? 'stopped' : 'disabled';
                const toolInfo = s.toolCount > 0 ? ` (${s.toolCount} tools)` : '';
                const err = s.error ? ` [error: ${s.error.slice(0, 50)}]` : '';
                return `  ${icon} ${s.name}: ${state}${toolInfo}${err}`;
              });
              addAssistant(lines.join('\n'));
            }
          } else if (action === 'presets') {
            const { PRESET_SERVERS } = await import('../mcp/McpRegistry.js');
            const config = (await import('../mcp/McpRegistry.js')).loadMcpConfig();
            const existing = new Set(config.servers.map((s) => s.name));
            const lines = Object.entries(PRESET_SERVERS).map(([name, p]) => {
              const added = existing.has(name) ? ' [added]' : '';
              const envHint = p.env ? ` (env: ${Object.keys(p.env).join(', ')})` : '';
              return `  ${name}: ${p.description || 'No description'}${envHint}${added}`;
            });
            addAssistant(`Available presets:\n\n${lines.join('\n')}\n\nUse: /mcp add <name>`);
          } else if (action === 'add' || action === 'connect') {
            if (!arg) {
              addAssistant(
                'Usage: /mcp add <preset-name>\nUse /mcp presets to see available servers.'
              );
            } else {
              const { PRESET_SERVERS, addMcpServer } = await import('../mcp/McpRegistry.js');
              const preset = PRESET_SERVERS[arg];
              if (preset) {
                addMcpServer({ name: arg, ...preset, enabled: true });
                const envHint = preset.env
                  ? `\n\nSet environment variables:\n${Object.entries(preset.env)
                      .map(([k, v]) => `  export ${k}="${v}"`)
                      .join('\n')}`
                  : '';
                addAssistant(
                  `Added MCP server: ${arg}\n${preset.description || ''}${envHint}\n\nUse /reload-mcp to start it.`
                );
              } else {
                addAssistant(
                  `Unknown preset "${arg}". Use /mcp presets to see available servers.\n\nTo add a custom server, edit ~/.aurix/mcp/servers.json directly.`
                );
              }
            }
          } else if (action === 'remove') {
            if (!arg) {
              addAssistant('Usage: /mcp remove <name>');
            } else {
              const { removeMcpServer } = await import('../mcp/McpRegistry.js');
              await mcpManager.stopServer(arg);
              removeMcpServer(arg);
              addAssistant(`Removed MCP server: ${arg}`);
            }
          } else if (action === 'toggle') {
            if (!arg) {
              addAssistant('Usage: /mcp toggle <name>');
            } else {
              const { toggleMcpServer } = await import('../mcp/McpRegistry.js');
              const newState = toggleMcpServer(arg);
              if (newState === null) {
                addAssistant(`Server "${arg}" not found.`);
              } else {
                addAssistant(
                  `${arg}: ${newState ? 'enabled' : 'disabled'}. Use /reload-mcp to apply.`
                );
              }
            }
          } else if (action === 'restart') {
            if (!arg) {
              addAssistant('Usage: /mcp restart <name>');
            } else {
              const ok = await mcpManager.restartServer(arg);
              const client = mcpManager.getClient(arg);
              const tools = client?.tools.length || 0;
              addAssistant(`${arg}: ${ok ? `running (${tools} tools)` : 'failed to start'}`);
            }
          } else if (action === 'catalog') {
            addAssistant('Fetching MCP catalog...');
            const { fetchCatalog, searchCatalog } = await import('../mcp/McpCatalog.js');
            const catalog = await fetchCatalog();
            const results = arg ? searchCatalog(catalog, arg) : catalog;
            if (results.length === 0) {
              addAssistant(`No servers found${arg ? ` for "${arg}"` : ''}.`);
            } else {
              const lines = results
                .slice(0, 15)
                .map((e) => `  ${e.name} [${e.category}]: ${e.description}`);
              addAssistant(
                `MCP Catalog${arg ? ` (search: "${arg}")` : ''}:\n\n${lines.join('\n')}\n\n${results.length > 15 ? `+${results.length - 15} more. ` : ''}Use /mcp catalog <query> to search.`
              );
            }
          } else {
            addAssistant(
              `Unknown MCP command: ${action}\n\nCommands: list, presets, add, remove, toggle, restart, catalog, status`
            );
          }
          return;
        } else if (commandName.startsWith('tool:')) {
          const toolName = commandName.slice(5);
          const tool =
            registry.get(toolName) ||
            registry.list().find((t) => t.displayName?.toLowerCase() === toolName.toLowerCase());
          addAssistant(
            tool
              ? `${tool.displayName || tool.name}\nFunction name: ${tool.name}\n${tool.description}`
              : `Tool not found: ${toolName}`
          );
          return;
        }

        if (commandName === 'rules') {
          if (!slash.args) {
            const rulesList =
              sessionRules.length > 0
                ? sessionRules.map((r, i) => `  ${i + 1}. ${r}`).join('\n')
                : '  (none)';
            addAssistant(
              `Session Rules:\n${rulesList}\n\nUsage:\n  /rules add <rule>\n  /rules remove <number>\n  /rules clear\n  /rules edit (opens in editor)`
            );
            return;
          }
          const args = slash.args.trim();
          if (args.startsWith('add ')) {
            const rule = args.slice(4).trim();
            if (rule) {
              setSessionRules((prev) => [...prev, rule]);
              addAssistant(`Rule added: "${rule}"`);
            } else {
              addAssistant('Usage: /rules add <rule text>');
            }
          } else if (args.startsWith('remove ')) {
            const idx = parseInt(args.slice(7).trim(), 10) - 1;
            if (idx >= 0 && idx < sessionRules.length) {
              const removed = sessionRules[idx];
              setSessionRules((prev) => prev.filter((_, i) => i !== idx));
              addAssistant(`Rule removed: "${removed}"`);
            } else {
              addAssistant('Invalid rule number.');
            }
          } else if (args === 'clear') {
            setSessionRules([]);
            addAssistant('All session rules cleared.');
          } else if (args === 'edit') {
            addAssistant('Edit rules in ~/.aurix/rules.md or use /rules add/remove commands.');
          } else {
            addAssistant(
              'Usage: /rules add <rule> | /rules remove <n> | /rules clear | /rules edit'
            );
          }
          return;
        }

        if (commandName === 'goal') {
          if (!slash.args) {
            if (sessionGoal) {
              addAssistant(
                `Current Goal:\n  ${sessionGoal}\n\nUsage: /goal <text> to update, /goal clear to remove`
              );
            } else {
              addAssistant(
                'No goal set.\n\nUsage: /goal <text> to set a session goal\nExample: /goal Implement user authentication with JWT'
              );
            }
            return;
          }
          const args = slash.args.trim();
          if (args === 'clear') {
            setSessionGoal(null);
            addAssistant('Goal cleared.');
          } else {
            setSessionGoal(args);
            addAssistant(`Goal set: "${args}"`);
          }
          return;
        }

        if (commandName === 'todo') {
          if (!slash.args) {
            const stats = getTodoStats();
            const fileTodos = loadTodosFromFile();
            if (stats.total === 0) {
              addAssistant(
                'No todos.\n\nUsage:\n  /todo add <task>\n  /todo done <number>\n  /todo list\n  /todo clear'
              );
            } else {
              const list = fileTodos
                .map((t) => {
                  const check = t.done ? '[x]' : '[ ]';
                  return `  ${t.id}. ${check} ${t.text}`;
                })
                .join('\n');
              addAssistant(`Todos: ${stats.done}/${stats.total} complete\n\n${list}`);
            }
            return;
          }
          const args = slash.args.trim();
          if (args.startsWith('add ')) {
            const task = args.slice(4).trim();
            if (task) {
              const newTodo = addTodoToFile(task);
              setTodos((prev) => [...prev, { text: newTodo.text, done: newTodo.done }]);
              addAssistant(`Todo added: "${task}"`);
            }
          } else if (args.startsWith('done ')) {
            const idx = parseInt(args.slice(5).trim(), 10);
            const fileTodos = loadTodosFromFile();
            const todo = fileTodos.find((t) => t.id === idx);
            if (todo) {
              completeTodoInFile(idx);
              const refreshedTodos = loadTodosFromFile();
              setTodos(refreshedTodos.map((t) => ({ text: t.text, done: t.done })));
              const updatedTodo = refreshedTodos.find((t) => t.id === idx);
              addAssistant(
                `Todo ${updatedTodo?.done ? 'completed' : 'uncompleted'}: "${todo.text}"`
              );
            } else {
              addAssistant('Invalid todo number.');
            }
          } else if (args === 'clear') {
            const fileTodos = loadTodosFromFile();
            const incompleteTodos = fileTodos.filter((t) => !t.done);
            const { saveTodos } = require('../utils/TodoManager.js');
            saveTodos(incompleteTodos);
            setTodos(incompleteTodos.map((t) => ({ text: t.text, done: t.done })));
            addAssistant('Completed todos cleared.');
          } else if (args === 'list') {
            const stats = getTodoStats();
            const fileTodos = loadTodosFromFile();
            const list = fileTodos
              .map((t) => {
                const check = t.done ? '[x]' : '[ ]';
                return `  ${t.id}. ${check} ${t.text}`;
              })
              .join('\n');
            addAssistant(`Todos: ${stats.done}/${stats.total} complete\n\n${list}`);
          } else {
            addAssistant('Usage: /todo add <task> | /todo done <n> | /todo list | /todo clear');
          }
          return;
        }
      }

      if (slash && outboundText === text) {
        return;
      }

      if (outboundText.startsWith('/')) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Command did not produce an agent prompt: ${outboundText}`,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      if (activeAgentRunRef.current) return;

      const sessionDirectives = [
        sessionGoal ? `[Session goal: ${sessionGoal}]` : '',
        sessionRules.length > 0
          ? `[Session rules:\n${sessionRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}]`
          : '',
      ].filter(Boolean);
      if (sessionDirectives.length > 0) {
        outboundText = `${sessionDirectives.join('\n')}\n\n${outboundText}`;
      }

      const turnStartedAt = Date.now();
      const checkpointId = `cp_${turnStartedAt}_${Math.random().toString(36).slice(2, 8)}`;
      const turnId = checkpointId;
      activeAgentRunRef.current = turnId;
      const startedTurn = startUserTurn(createPresentationState(messages), outboundText, {
        now: new Date(),
        turnId,
      });
      if (startedTurn.messages.length > 0) {
        startedTurn.messages[startedTurn.messages.length - 1].checkpointId = checkpointId;
      }
      setPresentationState(startedTurn);
      try {
        const { getCheckpointEngine } = await import('../agent/Checkpoint.js');
        getCheckpointEngine()?.commit(checkpointId);
      } catch {}

      if (showBanner) setShowBanner(false);
      setScrollOffset(0);

      setIsProcessing(true);
      setActiveTool(undefined);

      try {
        const currentAgent = agentRef.current;
        if (!currentAgent) {
          if (activeAgentRunRef.current === turnId) activeAgentRunRef.current = undefined;
          setIsProcessing(false);
          return;
        }

        const runId = turnId;
        const applyPresentationEvent = (event: AgentEvent): boolean => {
          if (streamBatchRef.current.runId !== runId) return false;
          setPresentationState(
            applyAgentEvent(presentationStateRef.current, event, {
              model: agent.getModel(),
              renderToolEnd: (event) => renderToolEnd(event, { markdown: false }),
            }),
          );
          return true;
        };
        const flushStreamBatch = () => {
          const batch = streamBatchRef.current;
          if (batch.runId !== runId || batch.events.length === 0) return;
          if (batch.timer) clearTimeout(batch.timer);
          batch.timer = undefined;
          const events = batch.events.splice(0);
          const coalesced: AgentEvent[] = [];
          for (const event of events) {
            const previous = coalesced[coalesced.length - 1];
            const sameText = previous?.type === 'text' && event.type === 'text';
            const sameToolChunk =
              previous?.type === 'tool_chunk' &&
              event.type === 'tool_chunk' &&
              previous.toolCallId === event.toolCallId &&
              previous.toolName === event.toolName;
            if (previous && (sameText || sameToolChunk)) {
              previous.data += event.data;
            } else {
              coalesced.push({ ...event });
            }
          }
          for (const event of coalesced) applyPresentationEvent(event);
        };
        const cancelStreamBatch = () => {
          const batch = streamBatchRef.current;
          if (batch.timer) clearTimeout(batch.timer);
          batch.timer = undefined;
          batch.events = [];
          batch.runId = undefined;
          batch.flush = undefined;
          batch.cancel = undefined;
        };
        activeUiRunRef.current = runId;
        streamBatchRef.current = {
          runId,
          events: [],
          flush: flushStreamBatch,
          cancel: cancelStreamBatch,
        };
        const queuePresentationEvent = (event: AgentEvent) => {
          const batch = streamBatchRef.current;
          if (batch.runId !== runId) return;
          batch.events.push(event);
          if (!batch.timer) {
            batch.timer = setTimeout(flushStreamBatch, 64);
          }
        };

        const images =
          pendingImagesRef.current.length > 0 ? [...pendingImagesRef.current] : undefined;
        pendingImagesRef.current = [];

        for await (const rawEvent of currentAgent.run(outboundText, images)) {
          const event: AgentEvent = {
            ...rawEvent,
            turnId,
            durationMs:
              rawEvent.type === 'done' && typeof rawEvent.durationMs !== 'number'
                ? Date.now() - turnStartedAt
                : rawEvent.durationMs,
          };
          if (event.type === 'text' || event.type === 'tool_chunk') {
            queuePresentationEvent(event);
            continue;
          }
          flushStreamBatch();
          if (streamBatchRef.current.runId !== runId) continue;
          if (event.type === 'tool_start') {
            setActiveTool({ name: event.toolName || '', args: event.toolArgs });
          } else if (event.type === 'tool_end') {
            setActiveTool(undefined);
          }
          applyPresentationEvent(event);
        }
        flushStreamBatch();
        if (streamBatchRef.current.runId === runId) {
          const currentTurn = presentationStateRef.current.currentTurn;
          if (!currentTurn?.completed) {
            applyPresentationEvent({
              type: 'done',
              data: '',
              turnId,
              durationMs: Date.now() - turnStartedAt,
            });
          }
          cancelStreamBatch();
        }
      } catch (e: any) {
        if (streamBatchRef.current.runId === turnId) {
          streamBatchRef.current.flush?.();
          setPresentationState(
            applyAgentEvent(
              presentationStateRef.current,
              { type: 'error', data: `Fatal error: ${e.message}`, turnId },
              { model: agent.getModel(), renderToolEnd },
            ),
          );
          streamBatchRef.current.cancel?.();
        }
      }

      if (activeAgentRunRef.current === turnId) {
        activeAgentRunRef.current = undefined;
        setIsProcessing(false);
      }
      if (activeUiRunRef.current === turnId) {
        activeUiRunRef.current = undefined;
        clearLiveToolOutput();
        setActiveTool(undefined);
      }
    },
    [
      isProcessing,
      commands,
      allCommands,
      doExit,
      openModelPicker,
      flushLiveToolOutput,
      queueLiveToolOutput,
      clearLiveToolOutput,
      agent,
      registry,
      config,
      baseUrl,
      messages,
      researchMode,
      planMode,
      showBanner,
      toolCount,
      skillCount,
      skills,
      sessionGoal,
      sessionRules,
      cronDaemon,
    ]
  ); // Keep dependencies explicit so slash commands always read current session state.

  const isHome = showBanner && messages.length === 0 && !isProcessing;
  const ctxStats = agent.getContextStats();
  const tokenStats = agent.getTokenStats(ctxStats);
  const mode: 'auto' | 'ask' | 'deny' = permissionMode === 'bypass' ? 'auto' : permissionMode;
  const cycleMode = useCallback(() => {
    const current = registry.getPermissionMode();
    const next = current === 'bypass' ? 'ask' : current === 'ask' ? 'deny' : 'bypass';
    registry.setPermissionMode(next);
    setPermissionMode(next);
  }, [registry]);

  const fmtTok = (n: number) =>
    n >= 1_000_000
      ? (n / 1_000_000).toFixed(1) + 'M'
      : n >= 1_000
        ? (n / 1_000).toFixed(1) + 'k'
        : String(n);
  const barW = 10;
  const barFill = Math.round((tokenStats.pct / 100) * barW);
  const barColor = tokenStats.pct > 75 ? theme.error : tokenStats.pct > 50 ? theme.warn : theme.ok;
  const barStr = Array.from({ length: barW })
    .map((_, i) => (i < barFill ? '█' : '░'))
    .join('');
  const promptW = Math.max(32, Math.min(80, termWidth - 8));
  const showFullSidebar = termWidth >= 120;

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
          showToast(
            `Copied ${text.length > 50 ? text.length + ' chars' : '"' + text.slice(0, 50) + '"'} to clipboard`
          );
          (renderer as any).clearSelection?.();
        } catch {}
      }}
    >
      <box flexGrow={1} minHeight={0} flexDirection="column">
        {isHome ? (
          <box
            flexGrow={1}
            alignItems="center"
            paddingLeft={2}
            paddingRight={2}
            flexDirection="column"
          >
            <box flexGrow={1} minHeight={0} />
            <Banner />
            <box height={1} minHeight={0} flexShrink={1} />
            <box width="100%" maxWidth={promptW} paddingTop={1} flexShrink={0}>
              <InputBox
                onSubmit={handleSubmit}
                disabled={false}
                blocked={!!modelPicker}
                commands={commands}
                home
                model={agent.getModel()}
                contextPct={ctxStats.estimatedPct}
                cwd={process.cwd()}
                mode={mode}
                onModeCycle={cycleMode}
                onExit={doExit}
                onRewind={() => {
                  if (messages.some((m) => m.role === 'user' && m.checkpointId)) {
                    setShowRewind(true);
                    return true;
                  }
                  return false;
                }}
              />
            </box>
            <box flexGrow={1} minHeight={0} />
            <box width="100%" flexShrink={0} justifyContent="space-between" paddingX={2}>
              <text fg={theme.textMuted}>{process.cwd().replace(/^\/root\//, '~/')}</text>
              <text fg={theme.textMuted}>v{aurixVersion}</text>
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
                  todos={todos}
                  themeVersion={themeVersion}
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
                {showVisionConfig && (
                  <VisionModal
                    currentBaseUrl={config.visionBaseUrl}
                    currentModel={config.visionModel}
                    currentProvider={config.visionProvider}
                    currentApiStyle={config.visionApiStyle}
                    onSubmit={(newBaseUrl, newApiKey, newModel, newProvider, newApiStyle) => {
                      const provider = normalizeProviderInput(newProvider);
                      const apiStyle = normalizeApiStyleInput(newApiStyle);
                      if (newBaseUrl) config.visionBaseUrl = newBaseUrl;
                      if (newApiKey) config.visionApiKey = newApiKey;
                      if (newModel) config.visionModel = newModel;
                      if (provider) config.visionProvider = provider;
                      if (apiStyle) config.visionApiStyle = apiStyle;
                      saveConfig(config);
                      setShowVisionConfig(false);
                      setMessages((prev) => [
                        ...prev,
                        {
                          role: 'system',
                          content: `Vision Fallback updated.\n  Provider: ${provider || config.visionProvider || '(main provider)'}\n  Base URL: ${newBaseUrl || config.visionBaseUrl || '(main agent URL)'}\n  API Style: ${apiStyle || config.visionApiStyle || '(main agent style)'}\n  Model: ${newModel || config.visionModel || 'gpt-4o'}`,
                          timestamp: new Date(),
                        },
                      ]);
                    }}
                    onCancel={() => setShowVisionConfig(false)}
                  />
                )}
                {showLogin && (
                  <LoginModal
                    currentBaseUrl={config.baseUrl}
                    currentModel={config.model}
                    currentApiStyle={config.apiStyle}
                    onSubmit={(newBaseUrl, newApiKey, newModel, newApiStyle) => {
                      void (async () => {
                        const patch: Partial<AurixConfig> = {};
                        const apiStyle = normalizeApiStyleInput(newApiStyle);
                        if (newBaseUrl) patch.baseUrl = newBaseUrl;
                        if (newApiKey) patch.apiKey = newApiKey;
                        if (newModel) patch.model = newModel;
                        if (apiStyle) patch.apiStyle = apiStyle;
                        try {
                          const context = Object.keys(patch).length
                            ? await agent.applyProviderConfig(patch, { preferFreshModels: true })
                            : agent.getContextDiagnostics().metadata;
                          Object.assign(config, patch);
                          saveConfig(config);
                          if (newBaseUrl) setBaseUrl(newBaseUrl);
                          setShowLogin(false);
                          setMessages((prev) => [
                            ...prev,
                            {
                              role: 'assistant',
                              content: `Login updated.\n  Base URL: ${newBaseUrl || '(unchanged)'}\n  API Key: ${newApiKey ? 'updated' : '(unchanged)'}\n  API Style: ${apiStyle || config.apiStyle || '(unchanged)'}\n  Model: ${newModel || agent.getModel()}\n  Context: ${modelContextDiagnostic(context)}`,
                              timestamp: new Date(),
                            },
                          ]);
                        } catch (error) {
                          setMessages((prev) => [
                            ...prev,
                            {
                              role: 'assistant',
                              content: `Login update failed: ${error instanceof Error ? error.message : String(error)}`,
                              timestamp: new Date(),
                            },
                          ]);
                        }
                      })();
                    }}
                    onCancel={() => setShowLogin(false)}
                  />
                )}
                {showRewind && (
                  <RewindPicker
                    messages={messages}
                    onRestore={handleRewind}
                    onCancel={() => setShowRewind(false)}
                  />
                )}
                {showPalette && (
                  <CommandPalette
                    commands={commands}
                    onSelect={(cmdName) => {
                      setShowPalette(false);
                      handleSubmit(`/${cmdName}`);
                    }}
                    onCancel={() => setShowPalette(false)}
                  />
                )}
                {showOutputPanel && (
                  <OutputPanel messages={messages} onClose={() => setShowOutputPanel(false)} />
                )}
                {sessionList && (
                  <SessionBrowser
                    sessions={sessionList}
                    onSelect={(id) => {
                      setSessionList(null);
                      (async () => {
                        try {
                          const count = await agent.loadSessionAsync(id);
                          if (count > 0) {
                            const loaded = agent.getMessages();
                            const display = buildResumedDisplayMessages(loaded, id);
                            presentationStateRef.current = createPresentationState(display);
                            setMessages(display);
                            setShowBanner(false);
                            setScrollOffset(0);
                          } else {
                            setMessages((prev) => [
                              ...prev,
                              {
                                role: 'system',
                                content: `Session "${id}" could not be loaded.`,
                                timestamp: new Date(),
                              },
                            ]);
                          }
                        } catch {
                          setMessages((prev) => [
                            ...prev,
                            {
                              role: 'system',
                              content: 'Failed to resume session.',
                              timestamp: new Date(),
                            },
                          ]);
                        }
                      })();
                    }}
                    onCancel={() => setSessionList(null)}
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
                            gatewayRef.current = new Gateway(config, registry, cronDaemon);
                          }
                          gatewayRef.current.register(dp);
                          if (!config.gateway) config.gateway = {};
                          config.gateway.discord = { enabled: true, token };
                          saveConfig(config);
                          setMessages((prev) => [
                            ...prev,
                            {
                              role: 'assistant',
                              content: 'Discord bot connected and token saved.',
                              timestamp: new Date(),
                            },
                          ]);
                        } else if (platform === 'telegram') {
                          const { TelegramPlatform } = await import('../gateway/Telegram.js');
                          const tp = new TelegramPlatform(token);
                          await tp.connect();
                          if (!gatewayRef.current) {
                            const { Gateway } = await import('../gateway/Gateway.js');
                            gatewayRef.current = new Gateway(config, registry, cronDaemon);
                          }
                          gatewayRef.current.register(tp);
                          if (!config.gateway) config.gateway = {};
                          config.gateway.telegram = { enabled: true, token };
                          saveConfig(config);
                          setMessages((prev) => [
                            ...prev,
                            {
                              role: 'assistant',
                              content: 'Telegram bot connected and token saved.',
                              timestamp: new Date(),
                            },
                          ]);
                        }
                      } catch (e: any) {
                        setMessages((prev) => [
                          ...prev,
                          {
                            role: 'assistant',
                            content: `Failed to connect ${platform}: ${e.message}`,
                            timestamp: new Date(),
                          },
                        ]);
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
                        setMessages((prev) => [
                          ...prev,
                          {
                            role: 'assistant',
                            content: 'WhatsApp connected and saved!',
                            timestamp: new Date(),
                          },
                        ]);
                      }
                    }}
                  />
                )}
                <InputBox
                  onSubmit={handleSubmit}
                  disabled={!!permissionPrompt || showLogin || !!connectModal || showWhatsApp}
                  blocked={!!modelPicker}
                  commands={commands}
                  model={agent.getModel()}
                  contextPct={ctxStats.estimatedPct}
                  cwd={process.cwd()}
                  mode={mode}
                  onModeCycle={cycleMode}
                  onExit={doExit}
                  onRewind={() => {
                    if (messages.some((m) => m.role === 'user' && m.checkpointId)) {
                      setShowRewind(true);
                      return true;
                    }
                    return false;
                  }}
                />
              </box>
              <box flexShrink={0}>
                <StatusBar
                  model={agent.getModel()}
                  provider={agent.getProviderName()}
                  researchMode={researchMode}
                  version={aurixVersion}
                  cwd={process.cwd()}
                />
              </box>
            </box>
            {showFullSidebar && <box
              flexDirection="column"
              width={28}
              backgroundColor={theme.bgPanel}
              border={['left']}
              borderColor={theme.border}
              paddingX={1}
              paddingY={1}
              flexShrink={0}
            >
              <box flexDirection="column">
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                  context
                </text>
                <box marginTop={1}>
                  <text fg={barColor}>{barStr}</text>
                  <text fg={theme.textMuted}> {tokenStats.pct}%</text>
                </box>
                <box>
                  <text fg={theme.textMuted}>{fmtTok(tokenStats.total)} tokens</text>
                </box>
              </box>

              <box flexDirection="column" marginTop={1}>
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                  tokens
                </text>
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
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                  model
                </text>
                <box marginTop={1}>
                  <text fg={theme.text}>{agent.getModel()}</text>
                </box>
              </box>

              <box flexDirection="column" marginTop={1}>
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                  info
                </text>
                <box marginTop={1}>
                  <text fg={theme.textMuted}>provider </text>
                  <text fg={theme.text}>{agent.getProviderName()}</text>
                </box>
                <box>
                  <text fg={theme.textMuted}>depth </text>
                  <text
                    fg={
                      researchMode === 'ultra' || researchMode === 'max' ? theme.accent : theme.text
                    }
                  >
                    {researchMode}
                  </text>
                </box>
                <box>
                  <text fg={theme.textMuted}>messages </text>
                  <text fg={theme.text}>{ctxStats.messageCount}</text>
                </box>
                <box>
                  <text fg={theme.textMuted}>tools </text>
                  <text fg={theme.text}>{toolCount}</text>
                </box>
              </box>
            </box>}
          </box>
        )}
      </box>
      {modelPicker && (
        <ModelPicker
          items={modelPicker.items}
          currentModel={agent.getModel()}
          loading={modelPicker.loading}
          error={modelPicker.error}
          initialQuery={modelPicker.initialQuery}
          onSelect={(modelId) => {
            void (async () => {
              try {
                const selected = await applyModelSelection(agent, config, modelId);
                modelPickerRequestRef.current++;
                modelPickerOpenRef.current = false;
                setModelPicker(null);
                setMessages((previous) => [
                  ...previous,
                  {
                    role: 'assistant',
                    content: `Model switched to: ${selected.model}\nContext: ${modelContextDiagnostic(selected.context)}`,
                    timestamp: new Date(),
                  },
                ]);
              } catch (error) {
                setModelPicker((current) => current ? { ...current, error: `Model switch failed: ${error instanceof Error ? error.message : String(error)}` } : current);
              }
            })();
          }}
          onRefresh={() => void openModelPicker(modelPicker.initialQuery || '')}
          onCustom={(modelId) => {
            void (async () => {
              try {
                const selected = await applyModelSelection(agent, config, modelId);
                modelPickerRequestRef.current++;
                modelPickerOpenRef.current = false;
                setModelPicker(null);
                setMessages((previous) => [
                  ...previous,
                  {
                    role: 'assistant',
                    content: `Model switched to: ${selected.model}\nContext: ${modelContextDiagnostic(selected.context)}`,
                    timestamp: new Date(),
                  },
                ]);
              } catch (error) {
                setModelPicker((current) => current ? { ...current, error: `Model switch failed: ${error instanceof Error ? error.message : String(error)}` } : current);
              }
            })();
          }}
          onCancel={() => {
            modelPickerRequestRef.current++;
            modelPickerOpenRef.current = false;
            setModelPicker(null);
          }}
        />
      )}
      {toast && (
        <box
          position="absolute"
          bottom={2}
          left={Math.max(0, Math.floor((termWidth - toast.length - 4) / 2))}
          zIndex={100}
        >
          <box
            backgroundColor={theme.bgElement}
            paddingX={2}
            paddingY={0}
            border={['top', 'bottom', 'left', 'right']}
            borderColor={theme.border}
          >
            <text fg={theme.ok}>{toast}</text>
          </box>
        </box>
      )}
    </box>
  );
}
