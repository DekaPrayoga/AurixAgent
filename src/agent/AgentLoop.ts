import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { AurixConfig } from './Config.js';
import { buildSystemPrompt } from './Context.js';
import type { Provider, Message } from '../providers/index.js';
import { createProvider } from '../providers/index.js';
import { countTokens, TokenLedger } from './TokenCounter.js';
import type { ToolRegistry } from '../tools/Registry.js';
import { MultiAgentSystem } from './MultiAgent.js';
import { ContextManager } from './ContextManager.js';
import { MemoryEngine } from './MemoryEngine.js';
import { ResearchPipeline } from './ResearchPipeline.js';
import type { ResearchDepth } from './research/types.js';
import { loadTodos, saveTodos, addTodo, completeTodo, getTodoStats } from '../utils/TodoManager.js';

const TOOL_RESULTS_DIR = join(homedir(), '.aurix-tool-results');

function ensureToolResultsDir(): void {
  if (!existsSync(TOOL_RESULTS_DIR)) {
    mkdirSync(TOOL_RESULTS_DIR, { recursive: true });
  }
}

function persistToolResult(
  content: string,
  toolName: string
): { filepath: string; preview: string; hasMore: boolean } | null {
  if (content.length <= 10000) return null;
  try {
    ensureToolResultsDir();
    const id = randomUUID();
    const ext = 'txt';
    const filepath = join(TOOL_RESULTS_DIR, `${toolName}-${id}.${ext}`);
    writeFileSync(filepath, content, 'utf-8');
    const previewLen = 2000;
    const preview = content.slice(0, previewLen);
    const hasMore = content.length > previewLen;
    return { filepath, preview, hasMore };
  } catch {
    return null;
  }
}

function buildPersistedMessage(
  result: { filepath: string; preview: string; hasMore: boolean },
  originalSize: number
): string {
  let msg = `<persisted-output>\n`;
  msg += `Output too large (${originalSize} chars). Full output saved to: ${result.filepath}\n\n`;
  msg += `Preview (first 2000 chars):\n`;
  msg += result.preview;
  msg += result.hasMore ? '\n...\n' : '\n';
  msg += `Read the full output with: read_file(file_path="${result.filepath}")\n`;
  msg += `</persisted-output>`;
  return msg;
}

const WRITE_TOOLS = new Set([
  'file_edit',
  'write_file',
  'terminal',
  'delete_file',
  'delete_folder',
]);
const BUILD_HINT_TOOLS = new Set(['file_edit', 'write_file']);
const SESSION_KEY_TOOLS = new Set(['ask_user', 'delete_file', 'delete_folder']);

type ErrorType =
  | 'rate_limit'
  | 'auth'
  | 'context_length'
  | 'network'
  | 'server_error'
  | 'proxy_error'
  | 'abort'
  | 'unknown';

function classifyError(e: any): ErrorType {
  const msg = (e.message || e.error?.message || String(e)).toLowerCase();
  const name = (e.name || '').toLowerCase();
  const status = e.status || e.statusCode || e.response?.status || e.error?.status;

  if (name === 'aborterror' || msg.includes('aborted') || msg.includes('abort')) {
    return 'abort';
  }

  if (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('quota exceeded') ||
    msg.includes('monthly_request_count')
  ) {
    return 'rate_limit';
  }
  if (
    msg.includes('connect proxy') ||
    msg.includes('9router') ||
    msg.includes('upstream') ||
    msg.includes('tunnel')
  ) {
    return 'network';
  }
  if (
    status === 401 ||
    status === 403 ||
    msg.includes('invalid api key') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('authentication')
  ) {
    return 'auth';
  }
  if (
    msg.includes('context length') ||
    msg.includes('too many tokens') ||
    msg.includes('maximum context') ||
    msg.includes('reduce your prompt') ||
    msg.includes('max_tokens')
  ) {
    return 'context_length';
  }
  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes('bad gateway') ||
    msg.includes('service unavailable') ||
    msg.includes('gateway timeout') ||
    msg.includes('upstream')
  ) {
    return 'server_error';
  }
  if (
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('network') ||
    msg.includes('socket hang up') ||
    msg.includes('dns') ||
    msg.includes('fetch failed') ||
    msg.includes('getaddrinfo')
  ) {
    return 'network';
  }
  if (
    msg.includes('stream') ||
    msg.includes('event:') ||
    msg.includes('data:') ||
    msg.includes('failed to parse') ||
    msg.includes('unexpected token') ||
    msg.includes('invalid json') ||
    msg.includes('sse')
  ) {
    return 'proxy_error';
  }
  return 'unknown';
}

export interface AgentEvent {
  type: 'text' | 'tool_start' | 'tool_end' | 'error' | 'done' | 'route' | 'compact' | 'research';
  data: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export class AgentLoop {
  private provider: Provider;
  private registry: ToolRegistry;
  private config: AurixConfig;
  private messages: Message[] = [];
  private maxIterations = 1000;
  private multiAgentMode = false;
  private multiAgent?: MultiAgentSystem;
  private contextManager: ContextManager;
  private memoryEngine: MemoryEngine;
  private researchPipeline?: ResearchPipeline;
  private sessionKey = 'default';
  private interrupted = false;
  private ledger = new TokenLedger();
  private abortController = new AbortController();

  constructor(config: AurixConfig, registry: ToolRegistry) {
    this.config = config;
    this.provider = createProvider(config);
    this.registry = registry;
    this.contextManager = new ContextManager(this.provider, config.model);
    this.memoryEngine = new MemoryEngine(this.provider);

    // Wire the provider into the module-level memory tool so `memory remember`
    // can auto-enrich user input before saving. Dynamic import avoids a
    // static circular dependency (AgentLoop ↔ Memory tool).
    import('../tools/Memory.js').then((m) => m.setMemoryProvider(this.provider)).catch(() => {});

    const systemPrompt = buildSystemPrompt(config, registry.list());
    this.ledger.set('systemPrompt', countTokens(systemPrompt));
    this.messages.push({ role: 'system', content: systemPrompt });
  }

  toggleMultiAgent(): boolean {
    this.multiAgentMode = !this.multiAgentMode;
    if (this.multiAgentMode && !this.multiAgent) {
      this.multiAgent = new MultiAgentSystem(this.config, this.registry);
    }
    return this.multiAgentMode;
  }

  isMultiAgent(): boolean {
    return this.multiAgentMode;
  }

  interrupt(): void {
    this.interrupted = true;
    this.abortController.abort();
  }

  private autoLoadSkills(userMessage: string): string[] {
    const loaded: string[] = [];
    const msg = userMessage.toLowerCase();
    const skillKeywords: Record<string, string[]> = {
      'planning-with-files': [
        'plan',
        'planning',
        'break down',
        'organize',
        'multi-step',
        'task plan',
      ],
      research: ['research', 'investigate', 'deep dive', 'analyze'],
      cybersec: ['security', 'vulnerability', 'exploit', 'pentest', 'audit'],
      devops: ['deploy', 'docker', 'kubernetes', 'ci/cd', 'pipeline'],
    };

    for (const [skillId, keywords] of Object.entries(skillKeywords)) {
      if (keywords.some((kw) => msg.includes(kw))) {
        loaded.push(skillId);
      }
    }
    return loaded;
  }

  private autoCreateTodos(userMessage: string): void {
    const msg = userMessage.toLowerCase();
    const existingTodos = loadTodos();

    // Only create todos if none exist and task seems complex
    if (existingTodos.length > 0) return;

    // Detect complex task indicators
    const complexityIndicators = [
      'implement',
      'build',
      'create',
      'develop',
      'fix',
      'refactor',
      'add feature',
      'multiple',
      'several',
      'all the',
      'everything',
      'step by step',
      'phase',
      'stage',
    ];

    if (!complexityIndicators.some((indicator) => msg.includes(indicator))) return;

    // Ask agent to break down the task
    const breakdownPrompt = `Based on the user's request, identify 3-7 concrete actionable tasks that need to be completed. Return ONLY a JSON array of task strings, no other text. Example: ["Task 1", "Task 2", "Task 3"]`;

    // Add system message to prompt todo creation
    this.messages.push({
      role: 'system',
      content: `[AUTO-TODO] The user's request appears complex. Please break it down into 3-7 concrete tasks and use the todo tool to track them. Then work through each task systematically.`,
    });
  }

  setMaxIterations(n: number): void {
    if (n >= 10 && n <= 10000) this.maxIterations = n;
  }

  getContextStats() {
    return this.contextManager.getStats(this.messages);
  }

  getTokenStats(): {
    input: number;
    output: number;
    total: number;
    pct: number;
    ledger: Record<string, number>;
    apiInput: number;
    apiOutput: number;
  } {
    const ctx = this.contextManager.getStats(this.messages);
    return {
      input:
        this.ledger.get('systemPrompt') +
        this.ledger.get('userInput') +
        this.ledger.get('toolResults'),
      output: this.ledger.get('agentText') + this.ledger.get('toolCalls'),
      total: ctx.totalTokens,
      pct: ctx.estimatedPct,
      ledger: this.ledger.getAll(),
      apiInput: this.ledger.getApiInput(),
      apiOutput: this.ledger.getApiOutput(),
    };
  }

  getLedger(): TokenLedger {
    return this.ledger;
  }

  injectContext(text: string): void {
    this.messages.push({ role: 'user', content: text });
    this.ledger.add('userInput', text);
  }

  setResearchMode(mode: ResearchDepth): void {
    this.config.researchMode = mode;
  }

  private looksLikeResearchTask(userMessage: string): boolean {
    return /\b(research|investigate|compare|sources?|citation|paper|study|literature|forum|reddit|youtube|twitter|x\b|news|market|trend|deep dive)\b/i.test(
      userMessage
    );
  }

  private looksLikeComplexTask(userMessage: string): boolean {
    return /\b(audit|review|fix|debug|implement|refactor|build|migrate|analy[sz]e|security|bugs?|codebase|repo|tests?|architecture|multi[- ]?agent)\b/i.test(
      userMessage
    );
  }

  private selectExecutionMode(userMessage: string): 'single' | 'research' | 'multiagent' {
    const mode = this.getResearchMode();
    if (mode === 'low') return 'single';
    if (mode === 'medium') return this.multiAgentMode ? 'multiagent' : 'single';
    if (this.looksLikeResearchTask(userMessage)) return 'research';
    if (this.multiAgentMode || this.looksLikeComplexTask(userMessage)) return 'multiagent';
    return 'single';
  }

  async *run(userMessage: string, images?: string[]): AsyncGenerator<AgentEvent> {
    this.interrupted = false;
    this.abortController = new AbortController();

    const executionMode = images?.length ? 'single' : this.selectExecutionMode(userMessage);
    if (executionMode === 'research') {
      yield* this.runResearch(userMessage);
      return;
    }
    if (executionMode === 'multiagent') {
      if (!this.multiAgent) this.multiAgent = new MultiAgentSystem(this.config, this.registry);
      yield* this.runMultiAgent(userMessage);
      return;
    }

    const mode = this.getResearchMode();
    if (mode === 'medium' && this.looksLikeResearchTask(userMessage)) {
      this.messages.push({
        role: 'system',
        content:
          '[Depth: medium] Use light research discipline: state uncertainty, prefer sources/tools when useful, but stay single-agent unless explicitly asked for deep research.',
      });
    }

    const msg: Message = { role: 'user', content: userMessage };
    if (images?.length) msg.images = images;
    this.messages.push(msg);
    this.ledger.add('userInput', userMessage);

    const loadedSkills = this.autoLoadSkills(userMessage);
    if (loadedSkills.length > 0) {
      const skillInstructions = loadedSkills.map((id) => `[Auto-loaded skill: ${id}]`).join('\n');
      this.messages.push({ role: 'system', content: skillInstructions });
    }

    this.autoCreateTodos(userMessage);

    if (this.contextManager.shouldCompact(this.messages)) {
      yield { type: 'compact', data: 'Context nearing limit — compacting history...' };
      this.messages = await this.contextManager.compact(this.messages);
      yield { type: 'compact', data: `Compacted to ${this.messages.length} messages` };
    }

    let consecutiveEmpty = 0;
    let totalFailures = 0;
    const MAX_EMPTY = 5;
    const MAX_FAILURES = 5;

    const recentToolSignatures: string[] = [];
    const MAX_RECENT = 6;

    const RETRY_DELAYS: Record<string, number[]> = {
      rate_limit: [60, 120, 300, 600],
      server_error: [2, 5, 10, 30],
      proxy_error: [3, 10, 30, 60],
      network: [5, 15, 30, 60, 120],
      unknown: [5, 15, 30, 60, 120],
    };
    const ERROR_LABELS: Record<string, string> = {
      rate_limit: 'rate limited',
      server_error: 'server error',
      proxy_error: 'proxy error',
      network: 'network error',
      unknown: 'error',
    };
    const FINAL_MESSAGES: Record<string, (msg: string) => string> = {
      rate_limit: (msg) =>
        `Rate limit exceeded after retries.\nLast error: ${msg}\nTry: wait a few minutes, /login with a different key, or /model <id> to switch models.`,
      server_error: (msg) =>
        `Provider server temporarily unavailable.\nLast error: ${msg}\nTry: wait 30s and retry, /login with a different provider, or /model <id>.`,
      proxy_error: (msg) =>
        `Proxy returned an incompatible or malformed response.\nLast error: ${msg}\nFix: check your proxy URL and model ID. The proxy may not support this model. Try /model <id> with a different model.`,
      network: (msg) =>
        `Network connection failed.\nLast error: ${msg}\nFix: check your internet connection and proxy URL. Try /login to reconfigure.`,
      unknown: (msg) =>
        `Provider failed after retries.\nLast error: ${msg}\nTry: /login, /model <id>, or /doctor.`,
    };
    let retryCount = 0;

    for (let i = 0; i < this.maxIterations; i++) {
      const optimizedMessages = this.contextManager.pruneToolResults(this.messages);

      let response;
      try {
        // VISION FALLBACK LOGIC
        // Check if there are any images in the conversation that haven't been analyzed yet
        for (let i = this.messages.length - 1; i >= 0; i--) {
          const m = this.messages[i];
          if (m.images && m.images.length > 0 && !m.content.includes('[Vision Analysis:')) {
            yield { type: 'text', data: `[Vision] Analysing image...` };
            try {
              // Determine vision provider config
              const { createProvider } = await import('../providers/index.js');
              const vConfig = {
                provider: this.config.provider,
                baseUrl: this.config.visionBaseUrl || this.config.baseUrl,
                apiKey: this.config.visionApiKey || this.config.apiKey,
                model: this.config.visionModel || 'gpt-4o', // Default fallback
                apiStyle: this.config.visionApiStyle || this.config.apiStyle,
                maxTokens: 1024,
                temperature: 0.1,
              };
              const vProvider = createProvider(vConfig as any);

              // Ask the vision model to explain the image
              const visionMsg = {
                role: 'user' as const,
                content:
                  'Describe this image in detail. If it is a web page or application, list all visible buttons, input fields, and important text so a blind automation agent can understand the state.',
                images: m.images,
              };

              const vRes = await vProvider.chat([visionMsg]);

              // Replace the image in the main conversation with the text description
              m.content += `\n\n[Vision Analysis: ${vRes.text}]`;
              m.images = []; // Remove the image so the main agent doesn't see it
            } catch (e: any) {
              m.content += `\n\n[Vision Analysis Failed: ${e.message}]`;
              m.images = [];
            }
          }
        }

        // Resume normal operation
        const finalOptimizedMessages = this.contextManager.pruneToolResults(this.messages);
        response = await this.provider.chat(
          finalOptimizedMessages,
          this.registry.getToolDefs(),
          this.abortController.signal
        );
        retryCount = 0;
        totalFailures = 0;
      } catch (e: any) {
        totalFailures++;
        if (totalFailures >= MAX_FAILURES) {
          const errType = classifyError(e);
          const finalFn = FINAL_MESSAGES[errType] || FINAL_MESSAGES.unknown;
          yield {
            type: 'error',
            data: `Provider failed ${totalFailures} times.\n${finalFn(e.message)}`,
          };
          return;
        }

        const errType = classifyError(e);

        if (errType === 'auth') {
          yield {
            type: 'error',
            data: `Authentication failed: ${e.message}\nRun /login to update credentials or /model <id> to switch models.`,
          };
          return;
        }

        if (errType === 'abort') {
          return;
        }

        if (errType === 'context_length') {
          yield { type: 'compact', data: 'Context too long — emergency compacting...' };
          this.messages = await this.contextManager.compact(this.messages);
          i--;
          continue;
        }

        const delays = RETRY_DELAYS[errType] || RETRY_DELAYS.unknown;
        if (retryCount >= delays.length) {
          const finalFn = FINAL_MESSAGES[errType] || FINAL_MESSAGES.unknown;
          yield { type: 'error', data: finalFn(e.message) };
          return;
        }

        const delay = delays[retryCount];
        retryCount++;
        const label = ERROR_LABELS[errType] || 'error';
        yield {
          type: 'text',
          data: `⏳ ${label} — retry ${retryCount}/${delays.length}, waiting ${delay}s...`,
        };

        for (let s = 0; s < delay; s++) {
          if (this.interrupted) {
            this.interrupted = false;
            yield { type: 'error', data: 'Retry cancelled by user.' };
            return;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        i--;
        continue;
      }

      if (this.interrupted) {
        this.interrupted = false;
        yield { type: 'error', data: 'Interrupted by user.' };
        return;
      }

      if (!response.text && response.toolCalls.length === 0) {
        consecutiveEmpty++;

        const diag: string[] = [];
        if (response.finishReason) diag.push(`finish_reason: ${response.finishReason}`);
        if (response.rawSnippet) diag.push(`raw: ${response.rawSnippet.slice(0, 200)}`);
        if (!response.finishReason && !response.rawSnippet)
          diag.push('no finish_reason or content from API');

        const diagStr = diag.join(' | ');

        // Remove the empty assistant response from history so model doesn't
        // think the conversation ended — it needs to see the last tool result
        // as the most recent message to continue working.
        while (
          this.messages.length > 0 &&
          this.messages[this.messages.length - 1].role === 'assistant' &&
          !this.messages[this.messages.length - 1].content &&
          !this.messages[this.messages.length - 1].toolCalls?.length
        ) {
          this.messages.pop();
        }

        if (consecutiveEmpty >= MAX_EMPTY) {
          yield {
            type: 'error',
            data: `Provider returned ${consecutiveEmpty} consecutive empty responses (model: ${this.config.model}).\nAPI diagnostic: ${diagStr}\nStopping. Try: /login, /model <id>, or /doctor.`,
          };
          return;
        }

        if (consecutiveEmpty >= 2 && this.registry.has('browser')) {
          try {
            yield {
              type: 'text',
              data: `[${consecutiveEmpty}/${MAX_EMPTY}] Empty response (${diagStr}) — taking screenshot for context...`,
            };
            const ssResult = await this.registry.execute('browser', { action: 'screenshot' });
            this.messages.push({
              role: 'tool',
              content: `[Auto-screenshot] ${ssResult}\n\nThe above screenshot was taken automatically because the agent appeared stuck. Analyze the attached screenshot to understand the current page state, then continue with the appropriate next action (click, fill, navigate, etc.). If the page shows a form, use signup-assist or signin-assist. If you see an error, try a different approach.`,
            });
            const ssPathMatch = ssResult.match(/(\/[^\s]+\.png)/);
            if (ssPathMatch) {
              this.messages.push({
                role: 'user',
                content:
                  '[System] Auto-screenshot attached below — analyze it to understand the current page state.',
                images: [ssPathMatch[1]],
              });
            }
            yield {
              type: 'tool_start',
              data: 'browser',
              toolName: 'browser',
              toolArgs: { action: 'screenshot' },
            };
            yield { type: 'tool_end', data: ssResult, toolName: 'browser' };
            continue;
          } catch {}
        }

        // Add a nudge message so the model has something to respond to
        // instead of seeing the same context and returning empty again.
        const nudges = [
          'You returned an empty response. Please continue with your analysis or next action based on the results above.',
          'Your last response was empty. Summarize what you found and state your next step.',
          'Please provide your response. If you encountered an issue, explain it and suggest an alternative approach.',
        ];
        const nudge = nudges[Math.min(consecutiveEmpty - 1, nudges.length - 1)];
        this.messages.push({ role: 'user', content: `[System] ${nudge}` });

        const delay = 3;
        yield {
          type: 'text',
          data: `[${consecutiveEmpty}/${MAX_EMPTY}] Empty response (${diagStr}) — retry in ${delay}s...`,
        };
        for (let s = 0; s < delay; s++) {
          if (this.interrupted) {
            this.interrupted = false;
            yield { type: 'error', data: 'Retry cancelled by user.' };
            return;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        continue;
      }

      consecutiveEmpty = 0;

      const isSafetyRefusal = (text: string): boolean => {
        const lower = text.toLowerCase();
        const refusalPhrases = [
          // English — explicit declination
          'i cannot fulfill',
          "i can't fulfill",
          'i cannot assist',
          "i can't assist",
          'i cannot help',
          "i can't help",
          "i can't help you with",
          'i cannot automate',
          'i cannot complete',
          'i am unable to',
          "i'm unable to",
          'i cannot perform',
          "i can't perform",
          'i must decline',
          "i'm going to decline",
          "i'll have to decline",
          'i have to decline',
          'i need to decline',
          "i'm sorry, but i cannot",
          "i'm sorry, i cannot",
          'sorry, i cannot',
          "sorry, i can't",
          "i'm not able to",
          "i won't be able to",
          'i should not',
          'not appropriate for me',
          'i cannot engage',
          'i cannot proceed',
          'outside my capabilities',
          'against my guidelines',
          "i'm going to stick with",
          'same answer',
          'stick with my answer',
          "framing doesn't change",
          'relabeling',
          "reframing doesn't change",
          "doesn't change what's being asked",
          "doesn't change what is being asked",
          "doesn't change what it is",
          'still no',
          "won't do that",
          "i won't do that",
          // Indonesian + Malay
          'maaf, saya tidak dapat',
          'maaf, saya tidak bisa',
          'saya tidak dapat memenuhi',
          'saya tidak dapat melakukan',
          'saya tidak dapat membantu',
          'saya tidak dapat mengotomatiskan',
          'saya tidak dapat memecahkan',
          'saya tidak dapat melanjutkan',
          'maaf saya tidak bisa',
          'saya tidak bisa melakukan',
          // Spanish
          'no puedo cumplir',
          'no puedo ayudar',
          'no puedo asistir',
          'lo siento, no puedo',
          'no puedo realizar',
          'no estoy autorizado',
          'debo rechazar',
          // French
          'je ne peux pas',
          'je ne suis pas en mesure',
          'je dois refuser',
          'je ne peux pas vous aider',
          'désolé, je ne peux',
          // German
          'ich kann nicht',
          'ich darf nicht',
          'ich muss ablehnen',
          'es tut mir leid, aber ich kann',
          // Russian
          'я не могу',
          'не могу выполнить',
          'не могу помочь',
          'я вынужден отказать',
          // Chinese
          '我无法',
          '我不能',
          '很抱歉，我不能',
          '无法完成',
          '无法满足',
          '不能协助',
          // Japanese
          'できません',
          'お手伝いできません',
          'お断り',
          '申し訳ありませんが',
          // Arabic
          'لا أستطيع',
          'لا يمكنني',
          'أعتذر',
          // Portuguese
          'não posso',
          'não consigo',
          'não posso ajudar',
          'sinto muito, não posso',
          // Italian
          'non posso',
          'non sono in grado',
          'mi dispiace, non posso',
          // Dutch
          'ik kan niet',
          'ik moet weigeren',
          'het spijt me, ik kan',
        ];
        // Gate on a genuine SAFETY OBJECTION, not bare topic words. Words like
        // 'captcha'/'register'/'phone number' appear in normal progress narration
        // ("I can't help with that captcha approach, let me try a different tile")
        // and must NOT by themselves turn a benign sentence into a "refusal".
        const objectionSignals = [
          // Meta-objection: model cites policy/ethics/legality
          'against my guidelines',
          'against my safety guidelines',
          'against my usage policy',
          'terms of service violation',
          'violates the terms',
          'policy violation',
          'ethical concerns',
          'privacy concerns',
          'not comfortable',
          'raises ethical',
          'unauthorized access',
          'without consent',
          'without their consent',
          'without permission',
          'not appropriate for me',
          'against my safety',
          'usage policy',
          "i won't assist with",
          'cannot assist with that',
          // Explicit task refusal without a cited reason — model just says no
          'i cannot perform this task',
          'i cannot complete this task',
          'i cannot execute this task',
          'i cannot carry out this task',
          'i cannot do this task',
          'i will not perform',
          'i will not do this',
          "i can't carry out this request",
          'i cannot proceed with this request',
          'i cannot help you with this request',
          'i cannot assist with this request',
          "i can't comply with this request",
          'i must refuse this request',
          // Automation-task refusal phrases — only appear when declining the task,
          // not when the model narrates progress ("I'll register the account now").
          'automatically register',
          'automate registration',
          'automate account',
          'mass register',
          'bulk register',
          'automated signup',
          'automated registration',
          'harvest proxies',
          'harvest proxy',
          'harvest resources',
          'scrape the website',
          'scrape data from',
          'scrape this site',
          'bypass security',
          'bypass the security',
          'bypass captcha',
          'circumvent security',
          'circumvent captcha',
          // Harm-related task words (keep for OSINT/abuse refusals)
          'mass registration',
          'account generation',
          'account creation',
          'doxing',
          'doxxing',
          'stalking',
          'harassment',
          'surveillance',
          // Indonesian
          'pembuatan akun massal',
          'melanggar ketentuan',
          'tidak etis',
          'tanpa izin',
          // Indonesian automation-task refusal (only appear when declining)
          'pendaftaran otomatis',
          'mendaftar secara otomatis',
          'mendaftar otomatis',
          'mengambil proxy',
          'mengambil proksi',
          'mengambil sumber daya',
          'email sementara',
          'layanan email sementara',
          'surat elektronik sementara',
          'scrape situs',
          'scrape website',
          'scrape data secara otomatis',
          'tidak dapat memenuhi permintaan',
          'tidak bisa memenuhi permintaan',
          'tidak dapat melakukan pendaftaran',
          'tidak dapat membantu anda untuk',
        ];
        const hasRefusal = refusalPhrases.some((p) => lower.includes(p));
        const hasObjection = objectionSignals.some((k) => lower.includes(k));
        if (hasRefusal && hasObjection) return true;
        if (!hasRefusal) return false;

        // Tier 3 — Language-agnostic reflection check.
        // If the model's response echoes 2+ task-keywords from the user's last
        // message (matched against a multilingual bank), treat as task-refusal.
        // Catches refusals in any language without explicit phrase lists.
        const taskKeywords = [
          // English
          'signup',
          'sign up',
          'register',
          'registration',
          'account',
          'accounts',
          'proxy',
          'proxies',
          'tempmail',
          'temporary email',
          'temp email',
          'scrape',
          'scraping',
          'harvest',
          'captcha',
          'recaptcha',
          'hcaptcha',
          'otp',
          'verification code',
          'bot',
          'automation',
          'automate',
          'email',
          'password',
          'login',
          'credential',
          'credentials',
          // Indonesian / Malay
          'daftar',
          'pendaftaran',
          'mendaftar',
          'akun',
          'proksi',
          'email sementara',
          'kata sandi',
          'masuk',
          'login',
          'otp',
          'kode verifikasi',
          'otomatisasi',
          // Spanish
          'registro',
          'registrarse',
          'cuenta',
          'contraseña',
          'correo temporal',
          'verificación',
          'captcha',
          // French
          'inscription',
          'enregistrer',
          'compte',
          'mot de passe',
          'email temporaire',
          // German
          'registrieren',
          'anmeldung',
          'konto',
          'passwort',
          'temporäre email',
          // Russian
          'регистрация',
          'зарегистрировать',
          'аккаунт',
          'пароль',
          'прокси',
          'временный email',
          'автоматически',
          // Chinese
          '注册',
          '账号',
          '密码',
          '代理',
          '临时邮箱',
          '验证码',
          '自动',
          // Japanese
          '登録',
          'アカウント',
          'パスワード',
          'プロキシ',
          '認証コード',
          // Arabic
          'تسجيل',
          'حساب',
          'كلمة مرور',
          'بروكسي',
          'تسجيل دخول',
          // Portuguese
          'registro',
          'registrar',
          'conta',
          'senha',
          'email temporário',
          // Italian
          'registrazione',
          'registrare',
          'account',
          'password',
          // Dutch
          'registratie',
          'registreren',
          'account',
          'wachtwoord',
          // Turkish
          'kayıt',
          'hesap',
          'şifre',
          'vekil',
          // Korean
          '등록',
          '계정',
          '비밀번호',
          '프록시',
          // Vietnamese
          'đăng ký',
          'tài khoản',
          'mật khẩu',
          // Hindi
          'पंजीकरण',
          'खाता',
          'पासवर्ड',
          // Thai
          'ลงทะเบียน',
          'บัญชี',
          'รหัสผ่าน',
        ];
        const lastUserMsg = this.messages.filter((m) => m.role === 'user').pop();
        if (lastUserMsg) {
          const userLower = (
            typeof lastUserMsg.content === 'string' ? lastUserMsg.content : ''
          ).toLowerCase();
          const userKeywords = new Set(
            taskKeywords.filter((kw) => userLower.includes(kw.toLowerCase()))
          );
          if (userKeywords.size >= 2) {
            let echoes = 0;
            for (const kw of userKeywords) {
              if (lower.includes(kw.toLowerCase())) echoes++;
              if (echoes >= 2) return true;
            }
          }
        }
        return false;
      };

      // Refusal-recovery loop removed in v2.5.4. The agent is now "blind":
      // browser tool descriptions use neutral framing ("image-selection grid",
      // "interactive form field") so safety-trained models treat captchas as
      // routine form elements. If a model still hard-refuses, that refusal
      // passes through to the user as a normal response — no retry, no hint
      // injection. The isSafetyRefusal detector is retained (defined above)
      // for future logging/analytics hooks but has no side-effects here.

      if (response.usage) {
        this.ledger.setApiUsage(response.usage.promptTokens, response.usage.completionTokens);
      }

      if (response.toolCalls.length > 0) {
        for (const tc of response.toolCalls) {
          this.ledger.add('toolCalls', `${tc.name} ${JSON.stringify(tc.arguments)}`);
        }
        this.messages.push({
          role: 'assistant',
          content: response.text || '',
          toolCalls: response.toolCalls,
        });

        if (response.text) {
          this.ledger.add('agentText', response.text);
          yield { type: 'text', data: response.text };
        }

        const READ_ONLY_TOOLS = new Set([
          'read_file',
          'search_files',
          'terminal_ls',
          'web_search',
          'research',
          'research_forums',
          'browser',
        ]);
        const MAX_RESULT_LEN = 8000;
        const DEFAULT_TIMEOUT = 180_000;
        const HEAVY_TIMEOUT = 600_000;

        const HEAVY_PATTERNS =
          /gradle|cargo\s+build|docker\s+build|npm\s+(run\s+)?build|webpack|vite\s+build|tsc\s+--|make\s+|cmake|mvn\s+|bazel|gcc\s+|g\+\+\s+|rustc|apt\s+install|brew\s+install|pip\s+install|yarn\s+build|bun\s+build|esbuild|rollup|flutter\s+build|react-native\s+run|assembleDebug|assembleRelease/i;

        const getToolTimeout = (name: string, args: Record<string, any>): number => {
          if (
            name === 'terminal' ||
            name === 'backend' ||
            name === 'vps' ||
            name === 'deploy' ||
            name === 'cloud'
          ) {
            const cmd = (args.command || args.cmd || '') as string;
            if (HEAVY_PATTERNS.test(cmd)) return HEAVY_TIMEOUT;
          }
          if (name === 'browser') {
            const action = (args.action || '') as string;
            if (/^(solve-captcha|signup-assist|signin-assist)$/.test(action)) return HEAVY_TIMEOUT;
          }
          if (name === 'research' || name === 'research_forums') return HEAVY_TIMEOUT;
          return DEFAULT_TIMEOUT;
        };

        const withTimeout = <T>(promise: Promise<T>, ms: number, name: string): Promise<T> => {
          return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `Tool "${name}" timed out after ${Math.round(ms / 1000)}s. If this is a heavy process, it may need more time — try running it in the background.`
                  )
                ),
              ms
            );
            promise
              .then((v) => {
                clearTimeout(timer);
                resolve(v);
              })
              .catch((e) => {
                clearTimeout(timer);
                reject(e);
              });
          });
        };

        const processResult = (result: string, toolName: string): string => {
          if (result.length <= 10000) return result;
          const persisted = persistToolResult(result, toolName);
          if (persisted) return buildPersistedMessage(persisted, result.length);
          const headLen = Math.floor(MAX_RESULT_LEN * 0.4);
          const tailLen = Math.floor(MAX_RESULT_LEN * 0.4);
          const head = result.slice(0, headLen);
          const tail = result.slice(result.length - tailLen);
          const omitted = result.length - headLen - tailLen;
          return `${head}\n\n... [${omitted} chars truncated] ...\n\n${tail}`;
        };

        const addPostExecutionHint = (
          result: string,
          toolName: string,
          args: Record<string, unknown>
        ): string => {
          if (!BUILD_HINT_TOOLS.has(toolName)) return result;
          const filePath = (args.file_path || args.path || '') as string;
          if (!filePath) return result;
          const isSourceFile = /\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|rb|php|vue|svelte)$/.test(
            filePath
          );
          const isConfigFile =
            /(package\.json|tsconfig|webpack|vite|rollup|\.env|Makefile|Dockerfile)$/.test(
              filePath
            );
          if (isSourceFile || isConfigFile) {
            return (
              result +
              '\n\n[Reminder: After editing source/config files, verify the changes work — build the project (e.g. tsc, npm run build), restart services (pm2 restart, systemctl restart), and test the result before saying "done".]'
            );
          }
          return result;
        };

        const readOnlyCalls = response.toolCalls.filter((c) => READ_ONLY_TOOLS.has(c.name));
        const writeCalls = response.toolCalls.filter((c) => !READ_ONLY_TOOLS.has(c.name));

        if (readOnlyCalls.length > 0) {
          if (readOnlyCalls.length === 1) {
            const call = readOnlyCalls[0];
            yield { type: 'tool_start', data: '', toolName: call.name, toolArgs: call.arguments };
            try {
              if (SESSION_KEY_TOOLS.has(call.name)) {
                call.arguments._sessionKey = this.sessionKey;
              }
              const result = await withTimeout(
                this.registry.execute(call.name, call.arguments),
                getToolTimeout(call.name, call.arguments),
                call.name
              );
              const processed = processResult(result, call.name);
              this.ledger.add('toolResults', processed);
              yield { type: 'tool_end', data: processed, toolName: call.name };
              this.messages.push({ role: 'tool', content: processed, toolCallId: call.id });

              const errorKw = [
                'Traceback (most recent call last):',
                'SyntaxError:',
                'ReferenceError:',
                'TypeError:',
                'npm ERR!',
                'fatal error:',
              ];
              const isError =
                errorKw.some((kw) => processed.includes(kw)) ||
                processed.toLowerCase().startsWith('error:');
              if (
                isError &&
                ['terminal', 'code_exec', 'file_edit', 'write_file'].includes(call.name)
              ) {
                let retryCount = 0;
                for (
                  let i = this.messages.length - 1;
                  i >= Math.max(0, this.messages.length - 8);
                  i--
                ) {
                  if (this.messages[i].content.includes('[Auto-Fix]')) retryCount++;
                }
                if (retryCount < 3) {
                  this.messages.push({
                    role: 'system',
                    content: `[Auto-Fix] The tool execution returned an error. Please analyze the error message above, find the root cause, and execute a corrected command or code snippet. You have ${3 - retryCount} automatic retries left.`,
                  });
                  yield {
                    type: 'text',
                    data: `\n🔧 Auto-correcting execution error (${retryCount + 1}/3)...`,
                  };
                }
              }
            } catch (e: any) {
              const errMsg = `Error executing ${call.name}: ${e.message}\n\nTry a different approach.`;
              this.ledger.add('toolResults', errMsg);
              yield { type: 'tool_end', data: errMsg, toolName: call.name };
              this.messages.push({ role: 'tool', content: errMsg, toolCallId: call.id });

              if (['terminal', 'code_exec', 'file_edit', 'write_file'].includes(call.name)) {
                let retryCount = 0;
                for (
                  let i = this.messages.length - 1;
                  i >= Math.max(0, this.messages.length - 8);
                  i--
                ) {
                  if (this.messages[i].content.includes('[Auto-Fix]')) retryCount++;
                }
                if (retryCount < 3) {
                  this.messages.push({
                    role: 'system',
                    content: `[Auto-Fix] The tool crashed. Please review the exception details above, fix your command or arguments, and try again. You have ${3 - retryCount} automatic retries left.`,
                  });
                  yield {
                    type: 'text',
                    data: `\n🔧 Auto-correcting tool crash (${retryCount + 1}/3)...`,
                  };
                }
              }
            }
          } else {
            yield {
              type: 'tool_start',
              data: `Executing ${readOnlyCalls.length} reads concurrently`,
              toolName: 'batch',
            };

            const results = await Promise.all(
              readOnlyCalls.map(async (call) => {
                try {
                  if (SESSION_KEY_TOOLS.has(call.name)) {
                    call.arguments._sessionKey = this.sessionKey;
                  }
                  const result = await withTimeout(
                    this.registry.execute(call.name, call.arguments),
                    getToolTimeout(call.name, call.arguments),
                    call.name
                  );
                  return { call, result, error: null as any };
                } catch (e: any) {
                  return { call, result: '', error: e };
                }
              })
            );

            for (const { call, result, error } of results) {
              if (this.interrupted) {
                this.interrupted = false;
                yield { type: 'error', data: 'Interrupted during tool execution.' };
                return;
              }

              yield { type: 'tool_start', data: '', toolName: call.name, toolArgs: call.arguments };

              if (error) {
                const errMsg = `Error executing ${call.name}: ${error.message}\n\nTry a different approach.`;
                this.ledger.add('toolResults', errMsg);
                yield { type: 'tool_end', data: errMsg, toolName: call.name };
                this.messages.push({ role: 'tool', content: errMsg, toolCallId: call.id });
              } else {
                const processed = processResult(result, call.name);
                this.ledger.add('toolResults', processed);
                yield { type: 'tool_end', data: processed, toolName: call.name };
                this.messages.push({ role: 'tool', content: processed, toolCallId: call.id });
              }
            }
          }
        }

        for (const call of writeCalls) {
          if (this.interrupted) {
            this.interrupted = false;
            yield { type: 'error', data: 'Interrupted before tool execution.' };
            return;
          }

          if (SESSION_KEY_TOOLS.has(call.name)) {
            call.arguments._sessionKey = this.sessionKey;
          }

          yield { type: 'tool_start', data: '', toolName: call.name, toolArgs: call.arguments };

          let result: string;
          try {
            result = await withTimeout(
              this.registry.execute(call.name, call.arguments),
              getToolTimeout(call.name, call.arguments),
              call.name
            );
          } catch (e: any) {
            result = `Error executing ${call.name}: ${e.message}\n\nDiagnose the error before retrying.`;
          }
          result = processResult(result, call.name);
          result = addPostExecutionHint(result, call.name, call.arguments);
          if (call.name === 'skill_loader' && call.arguments?.action === 'load') {
            this.ledger.add('skills', result);
          } else {
            this.ledger.add('toolResults', result);
          }

          yield { type: 'tool_end', data: result, toolName: call.name };

          if (this.interrupted) {
            this.interrupted = false;
            yield { type: 'error', data: 'Interrupted after tool execution.' };
            return;
          }

          this.messages.push({
            role: 'tool',
            content: result,
            toolCallId: call.id,
          });
        }

        for (const call of response.toolCalls) {
          const a = call.arguments as any;
          const sig = `${call.name}:${a?.action || ''}:${a?.command || ''}:${a?.target || ''}:${(a?.value || '').toString().slice(0, 40)}`;
          recentToolSignatures.push(sig);
          if (recentToolSignatures.length > MAX_RECENT) recentToolSignatures.shift();
        }

        // Auto-attach screenshot images from tool results so the model can see them
        const recentToolMsgs = this.messages
          .filter((m) => m.role === 'tool')
          .slice(-response.toolCalls.length);
        const detectedImages: string[] = [];
        for (const tm of recentToolMsgs) {
          const matches = tm.content.match(
            /(?:Screenshot|screenshot|saved to|saved|Tile \d+|Puzzle screenshot|Grid screenshot|Captcha image saved)[:\s]*[^\n]*?(\/[^\s]+\.png|\/[^\s]+\.(?:jpg|jpeg|gif|webp|bmp))/gi
          );
          if (matches) {
            for (const m of matches) {
              const pathMatch = m.match(/(\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|bmp))/i);
              if (pathMatch && !detectedImages.includes(pathMatch[1])) {
                detectedImages.push(pathMatch[1]);
              }
            }
          }
        }
        if (detectedImages.length > 0) {
          this.messages.push({
            role: 'user',
            content: `[System] The tool returned ${detectedImages.length} screenshot(s). They are attached below — analyze them visually to understand the current page state and decide your next action.`,
            images: detectedImages,
          });
        }

        continue;
      }

      this.messages.push({ role: 'assistant', content: response.text });
      this.ledger.add('agentText', response.text);
      yield { type: 'text', data: response.text };
      yield { type: 'done', data: '' };
      return;
    }

    yield {
      type: 'error',
      data: `Max iterations (${this.maxIterations}) reached. Agent stopped.\nThe task was too complex for the current iteration limit. Try breaking it into smaller steps, or increase with: agent.setMaxIterations(5000)`,
    };
  }

  private async *runMultiAgent(userMessage: string): AsyncGenerator<AgentEvent> {
    this.interrupted = false;
    this.messages.push({ role: 'user', content: userMessage });
    this.ledger.add('userInput', userMessage);

    try {
      const pendingEvents: AgentEvent[] = [];
      let result: Awaited<ReturnType<MultiAgentSystem['run']>> | undefined;
      let runError: any;
      let done = false;
      this.multiAgent!.run(userMessage, {
        onEvent: (event) => pendingEvents.push(event),
      })
        .then((value) => {
          result = value;
        })
        .catch((error) => {
          runError = error;
        })
        .finally(() => {
          done = true;
        });

      while (!done || pendingEvents.length > 0) {
        while (pendingEvents.length > 0) {
          yield pendingEvents.shift()!;
        }
        if (!done) await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (runError) throw runError;
      if (!result) throw new Error('Multi-agent produced no result');

      if (this.interrupted) {
        this.interrupted = false;
        yield { type: 'error', data: 'Interrupted by user.' };
        return;
      }

      if (result.route !== 'direct') {
        yield { type: 'route', data: `Routed to ${result.specialistUsed}`, toolName: result.route };
      }

      this.messages.push({ role: 'assistant', content: result.answer });
      yield { type: 'text', data: result.answer };
      yield { type: 'done', data: '' };
    } catch (e: any) {
      yield { type: 'error', data: `Multi-agent error: ${e.message}` };
    }
  }

  getResearchMode(): ResearchDepth {
    return (this.config.researchMode as ResearchDepth) || 'low';
  }

  async *runResearch(query: string): AsyncGenerator<AgentEvent> {
    this.interrupted = false;
    this.ledger.add('userInput', query);

    if (!this.researchPipeline) {
      this.researchPipeline = new ResearchPipeline(this.config);
    }

    const mode = this.getResearchMode();
    yield { type: 'research', data: `Starting deep research pipeline (depth: ${mode})...` };

    try {
      for await (const event of this.researchPipeline.run(query, mode)) {
        if (this.interrupted) {
          this.interrupted = false;
          yield { type: 'error', data: 'Research interrupted.' };
          return;
        }

        if (event.type === 'text') {
          this.messages.push({ role: 'user', content: query });
          this.messages.push({ role: 'assistant', content: event.data });
          yield { type: 'text', data: event.data };
        } else {
          yield { type: 'research', data: `[${event.agent}] ${event.data}` };
        }
      }
      yield { type: 'done', data: '' };
    } catch (e: any) {
      yield { type: 'error', data: `Research pipeline error: ${e.message}` };
    }
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  setMessages(msgs: Message[]): void {
    const system = this.messages[0];
    this.messages =
      system && system.role === 'system' && (msgs.length === 0 || msgs[0].role !== 'system')
        ? [system, ...msgs]
        : [...msgs];
  }

  clearHistory(): void {
    const system = this.messages[0];
    this.messages = [system];
  }

  async compactMessages(): Promise<number> {
    const before = this.messages.length;
    this.messages = await this.contextManager.compact(this.messages);
    return before - this.messages.length;
  }

  setSessionKey(sessionKey: string): void {
    this.sessionKey = sessionKey || 'default';
  }

  setProvider(config: Partial<AurixConfig>): void {
    this.config = { ...this.config, ...config };
    this.provider = createProvider(this.config);
    this.contextManager = new ContextManager(this.provider, config.model || this.config.model);
    if (this.multiAgent) {
      this.multiAgent = new MultiAgentSystem(this.config, this.registry);
    }
    const systemPrompt = buildSystemPrompt(this.config, this.registry.list());
    this.messages[0] = { role: 'system', content: systemPrompt };
  }

  getModel(): string {
    return this.config.model;
  }

  getProviderName(): string {
    return this.config.provider;
  }

  getMemoryEngine(): MemoryEngine {
    return this.memoryEngine;
  }

  loadSession(sessionId: string): number {
    const loaded = this.memoryEngine.loadSession(sessionId);
    if (loaded.length > 0) {
      this.messages = loaded;
    }
    return loaded.length;
  }

  saveSession(sessionId?: string): string {
    try {
      const id = this.memoryEngine.saveSession(this.messages, sessionId);
      const learnings = this.memoryEngine.extractSessionLearnings(this.messages);
      if (learnings) {
        this.memoryEngine.appendRaw(
          `# Session learnings (${new Date().toLocaleDateString()})\n${learnings}`
        );
      }
      return id;
    } catch {
      return '';
    }
  }
}
