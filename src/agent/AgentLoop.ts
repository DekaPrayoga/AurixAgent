import type { AurixConfig } from './Config.js';
import { buildSystemPrompt } from './Context.js';
import type { Provider, Message, ToolCall } from '../providers/index.js';
import { createProvider } from '../providers/index.js';
import type { ToolRegistry } from '../tools/Registry.js';
import { MultiAgentSystem } from './MultiAgent.js';
import { ContextManager } from './ContextManager.js';
import { MemoryEngine } from './MemoryEngine.js';

export interface AgentEvent {
  type: 'text' | 'tool_start' | 'tool_end' | 'error' | 'done' | 'route' | 'compact';
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

    // Auto-compact if approaching context limit
    if (this.contextManager.shouldCompact(this.messages)) {
      yield { type: 'compact', data: 'Context nearing limit — compacting history...' };
      this.messages = await this.contextManager.compact(this.messages);
      yield { type: 'compact', data: `Compacted to ${this.messages.length} messages` };
    }

    for (let i = 0; i < this.maxIterations; i++) {
      const optimizedMessages = this.contextManager.pruneToolResults(this.messages);

      let response;
      try {
        response = await this.provider.chat(optimizedMessages, this.registry.getToolDefs());
      } catch (e: any) {
        yield { type: 'error', data: `Provider error: ${e.message}` };
        return;
      }

      if (this.interrupted) {
        this.interrupted = false;
        yield { type: 'error', data: 'Interrupted by user.' };
        return;
      }

      if (response.toolCalls.length > 0) {
        // Push assistant message WITH tool calls (required by OpenAI API)
        this.messages.push({
          role: 'assistant',
          content: response.text || '',
          toolCalls: response.toolCalls,
        });

        if (response.text) {
          this._outputTokens += Math.ceil(response.text.length / 4);
          yield { type: 'text', data: response.text };
        }

        for (const call of response.toolCalls) {
          if (this.interrupted) {
            this.interrupted = false;
            yield { type: 'error', data: 'Interrupted before tool execution.' };
            return;
          }

          yield { type: 'tool_start', data: '', toolName: call.name, toolArgs: call.arguments };

          const result = await this.registry.execute(call.name, call.arguments);
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

      if (!response.text && response.toolCalls.length === 0) {
        yield { type: 'error', data: `Provider returned empty response (model: ${this.config.model}).\nTry: /login to update credentials, /model <id> to switch, or /doctor to diagnose.` };
        return;
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
      const facts = this.memoryEngine.extractNotableFacts(this.messages);
      if (facts.length > 0) {
        this.memoryEngine.appendRaw(
          '# Notable facts from session\n' + facts.map(f => `- ${f}`).join('\n')
        );
      }
      return id;
    } catch {
      return '';
    }
  }
}
