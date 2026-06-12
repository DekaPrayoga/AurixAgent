import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { AurixConfig } from './Config.js';
import { buildSystemPrompt } from './Context.js';
import type { Provider, Message } from '../providers/index.js';
import { createProvider } from '../providers/index.js';
import type { ToolRegistry } from '../tools/Registry.js';
import { MultiAgentSystem } from './MultiAgent.js';
import { ContextManager } from './ContextManager.js';
import { MemoryEngine } from './MemoryEngine.js';
import { ResearchPipeline } from './ResearchPipeline.js';
import type { ResearchDepth } from './research/types.js';

const TOOL_RESULTS_DIR = join(homedir(), '.aurix-tool-results');

function ensureToolResultsDir(): void {
  if (!existsSync(TOOL_RESULTS_DIR)) {
    mkdirSync(TOOL_RESULTS_DIR, { recursive: true });
  }
}

function persistToolResult(content: string, toolName: string): { filepath: string; preview: string; hasMore: boolean } | null {
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

function buildPersistedMessage(result: { filepath: string; preview: string; hasMore: boolean }, originalSize: number): string {
  let msg = `<persisted-output>\n`;
  msg += `Output too large (${originalSize} chars). Full output saved to: ${result.filepath}\n\n`;
  msg += `Preview (first 2000 chars):\n`;
  msg += result.preview;
  msg += result.hasMore ? '\n...\n' : '\n';
  msg += `Read the full output with: read_file(file_path="${result.filepath}")\n`;
  msg += `</persisted-output>`;
  return msg;
}

const WRITE_TOOLS = new Set(['file_edit', 'write_file', 'terminal']);
const BUILD_HINT_TOOLS = new Set(['file_edit', 'write_file']);

type ErrorType = 'rate_limit' | 'auth' | 'context_length' | 'network' | 'unknown';

function classifyError(e: any): ErrorType {
  const msg = (e.message || e.error?.message || String(e)).toLowerCase();
  const status = e.status || e.statusCode || e.response?.status || e.error?.status;

  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota exceeded')) {
    return 'rate_limit';
  }
  if (status === 401 || status === 403 || msg.includes('invalid api key') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('authentication')) {
    return 'auth';
  }
  if (msg.includes('context length') || msg.includes('too many tokens') || msg.includes('maximum context') || msg.includes('reduce your prompt') || msg.includes('max_tokens')) {
    return 'context_length';
  }
  if (msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('network') || msg.includes('socket hang up') || msg.includes('dns') || msg.includes('fetch failed')) {
    return 'network';
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
  private maxIterations = 30;
  private multiAgentMode = false;
  private multiAgent?: MultiAgentSystem;
  private contextManager: ContextManager;
  private memoryEngine: MemoryEngine;
  private researchPipeline?: ResearchPipeline;
  private interrupted = false;
  private _inputTokens = 0;
  private _outputTokens = 0;

  constructor(config: AurixConfig, registry: ToolRegistry) {
    this.config = config;
    this.provider = createProvider(config);
    this.registry = registry;
    this.contextManager = new ContextManager(this.provider, config.model);
    this.memoryEngine = new MemoryEngine(this.provider);

    const systemPrompt = buildSystemPrompt(config, registry.list());
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
  }

  getContextStats() {
    return this.contextManager.getStats(this.messages);
  }

  getTokenStats(): { input: number; output: number; total: number; pct: number } {
    const ctx = this.contextManager.getStats(this.messages);
    return {
      input: this._inputTokens,
      output: this._outputTokens,
      total: ctx.totalTokens,
      pct: ctx.estimatedPct,
    };
  }

  async *run(userMessage: string): AsyncGenerator<AgentEvent> {
    this.interrupted = false;

    if (this.multiAgentMode && this.multiAgent) {
      yield* this.runMultiAgent(userMessage);
      return;
    }

    this.messages.push({ role: 'user', content: userMessage });
    this._inputTokens += Math.ceil(userMessage.length / 4);

    if (this.contextManager.shouldCompact(this.messages)) {
      yield { type: 'compact', data: 'Context nearing limit — compacting history...' };
      this.messages = await this.contextManager.compact(this.messages);
      yield { type: 'compact', data: `Compacted to ${this.messages.length} messages` };
    }

    let consecutiveEmpty = 0;
    let totalFailures = 0;
    const MAX_EMPTY = 3;
    const MAX_FAILURES = 5;

    const RETRY_DELAYS_NORMAL = [5, 15, 30, 60, 120];
    const RETRY_DELAYS_RATE_LIMIT = [60, 120, 300, 600];
    let retryCount = 0;

    for (let i = 0; i < this.maxIterations; i++) {
      const optimizedMessages = this.contextManager.pruneToolResults(this.messages);

      let response;
      try {
        response = await this.provider.chat(optimizedMessages, this.registry.getToolDefs());
        retryCount = 0;
        totalFailures = 0;
      } catch (e: any) {
        totalFailures++;
        if (totalFailures >= MAX_FAILURES) {
          yield { type: 'error', data: `Provider failed ${totalFailures} times. Last error: ${e.message}\nStopping. Try: /login, /model <id>, or /doctor.` };
          return;
        }

        const errType = classifyError(e);

        if (errType === 'auth') {
          yield { type: 'error', data: `Authentication failed: ${e.message}\nRun /login to update credentials or /model <id> to switch models.` };
          return;
        }

        if (errType === 'context_length') {
          yield { type: 'compact', data: 'Context too long — emergency compacting...' };
          this.messages = await this.contextManager.compact(this.messages);
          i--;
          continue;
        }

        const delays = errType === 'rate_limit' ? RETRY_DELAYS_RATE_LIMIT : RETRY_DELAYS_NORMAL;
        if (retryCount >= delays.length) {
          yield { type: 'error', data: `Provider failed after ${retryCount} retries. Error: ${e.message}\nStopping.` };
          return;
        }

        const delay = delays[retryCount];
        retryCount++;
        const label = errType === 'rate_limit' ? 'rate limited' : errType === 'network' ? 'network error' : 'error';
        yield { type: 'text', data: `⏳ ${label} — retry ${retryCount}/${delays.length}, waiting ${delay}s...` };

        for (let s = 0; s < delay; s++) {
          if (this.interrupted) {
            this.interrupted = false;
            yield { type: 'error', data: 'Retry cancelled by user.' };
            return;
          }
          await new Promise(r => setTimeout(r, 1000));
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
        if (consecutiveEmpty >= MAX_EMPTY) {
          yield { type: 'error', data: `Provider returned ${consecutiveEmpty} consecutive empty responses (model: ${this.config.model}).\nStopping. Try: /login, /model <id>, or /doctor.` };
          return;
        }
        const delay = RETRY_DELAYS_NORMAL[Math.min(retryCount, RETRY_DELAYS_NORMAL.length - 1)];
        retryCount++;
        yield { type: 'text', data: `⏳ Empty response (${consecutiveEmpty}/${MAX_EMPTY}) — retry in ${delay}s...` };
        for (let s = 0; s < delay; s++) {
          if (this.interrupted) {
            this.interrupted = false;
            yield { type: 'error', data: 'Retry cancelled by user.' };
            return;
          }
          await new Promise(r => setTimeout(r, 1000));
        }
        i--;
        continue;
      }

      consecutiveEmpty = 0;

      if (response.toolCalls.length > 0) {
        this.messages.push({
          role: 'assistant',
          content: response.text || '',
          toolCalls: response.toolCalls,
        });

        if (response.text) {
          this._outputTokens += Math.ceil(response.text.length / 4);
          yield { type: 'text', data: response.text };
        }

        const READ_ONLY_TOOLS = new Set(['read_file', 'search_files', 'terminal_ls', 'web_search', 'research', 'research_forums', 'browser']);
        const MAX_RESULT_LEN = 8000;

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

        const addPostExecutionHint = (result: string, toolName: string, args: Record<string, unknown>): string => {
          if (!BUILD_HINT_TOOLS.has(toolName)) return result;
          const filePath = (args.file_path || args.path || '') as string;
          if (!filePath) return result;
          const isSourceFile = /\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|rb|php|vue|svelte)$/.test(filePath);
          const isConfigFile = /(package\.json|tsconfig|webpack|vite|rollup|\.env|Makefile|Dockerfile)$/.test(filePath);
          if (isSourceFile || isConfigFile) {
            return result + '\n\n[Reminder: After editing source/config files, verify the changes work — build the project (e.g. tsc, npm run build), restart services (pm2 restart, systemctl restart), and test the result before saying "done".]';
          }
          return result;
        };

        const readOnlyCalls = response.toolCalls.filter(c => READ_ONLY_TOOLS.has(c.name));
        const writeCalls = response.toolCalls.filter(c => !READ_ONLY_TOOLS.has(c.name));

        if (readOnlyCalls.length > 0) {
          if (readOnlyCalls.length === 1) {
            const call = readOnlyCalls[0];
            yield { type: 'tool_start', data: '', toolName: call.name, toolArgs: call.arguments };
            try {
              const result = await this.registry.execute(call.name, call.arguments);
              const processed = processResult(result, call.name);
              this._outputTokens += Math.ceil(processed.length / 4);
              yield { type: 'tool_end', data: processed, toolName: call.name };
              this.messages.push({ role: 'tool', content: processed, toolCallId: call.id });
            } catch (e: any) {
              const errMsg = `Error executing ${call.name}: ${e.message}\n\nTry a different approach.`;
              this._outputTokens += Math.ceil(errMsg.length / 4);
              yield { type: 'tool_end', data: errMsg, toolName: call.name };
              this.messages.push({ role: 'tool', content: errMsg, toolCallId: call.id });
            }
          } else {
            yield { type: 'tool_start', data: `Executing ${readOnlyCalls.length} reads concurrently`, toolName: 'batch' };

            const results = await Promise.all(readOnlyCalls.map(async (call) => {
              try {
                const result = await this.registry.execute(call.name, call.arguments);
                return { call, result, error: null as any };
              } catch (e: any) {
                return { call, result: '', error: e };
              }
            }));

            for (const { call, result, error } of results) {
              if (this.interrupted) {
                this.interrupted = false;
                yield { type: 'error', data: 'Interrupted during tool execution.' };
                return;
              }

              yield { type: 'tool_start', data: '', toolName: call.name, toolArgs: call.arguments };

              if (error) {
                const errMsg = `Error executing ${call.name}: ${error.message}\n\nTry a different approach.`;
                this._outputTokens += Math.ceil(errMsg.length / 4);
                yield { type: 'tool_end', data: errMsg, toolName: call.name };
                this.messages.push({ role: 'tool', content: errMsg, toolCallId: call.id });
              } else {
                const processed = processResult(result, call.name);
                this._outputTokens += Math.ceil(processed.length / 4);
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

          yield { type: 'tool_start', data: '', toolName: call.name, toolArgs: call.arguments };

          let result: string;
          try {
            result = await this.registry.execute(call.name, call.arguments);
          } catch (e: any) {
            result = `Error executing ${call.name}: ${e.message}\n\nDiagnose the error before retrying.`;
          }
          result = processResult(result, call.name);
          result = addPostExecutionHint(result, call.name, call.arguments);
          this._outputTokens += Math.ceil(result.length / 4);

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

        continue;
      }

      this.messages.push({ role: 'assistant', content: response.text });
      yield { type: 'text', data: response.text };
      yield { type: 'done', data: '' };
      return;
    }

    yield { type: 'error', data: 'Max iterations reached. Agent stopped.' };
  }

  private async *runMultiAgent(userMessage: string): AsyncGenerator<AgentEvent> {
    this.interrupted = false;
    this.messages.push({ role: 'user', content: userMessage });

    try {
      const result = await this.multiAgent!.run(userMessage);

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

  clearHistory(): void {
    const system = this.messages[0];
    this.messages = [system];
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
