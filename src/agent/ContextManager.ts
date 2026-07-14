import type { Provider, Message } from '../providers/index.js';
import { countTokens } from './TokenCounter.js';
import { fallbackModelContextLimit } from './ModelContext.js';

export interface ContextStats {
  totalTokens: number;
  messageCount: number;
  compactedCount: number;
  estimatedPct: number;
}

const COMPACT_THRESHOLD = 0.85;

export class ContextManager {
  private compactCount = 0;
  private contextLimit: number;

  constructor(
    private provider: Provider,
    private model: string,
    contextLimit?: number
  ) {
    this.contextLimit = contextLimit || fallbackModelContextLimit(model);
  }

  setContextLimit(limit: number): void {
    if (Number.isFinite(limit) && limit > 0) this.contextLimit = Math.round(limit);
  }

  getContextLimit(): number {
    const configured = Number(process.env.AURIX_CONTEXT_LIMIT || process.env.CONTEXT_LIMIT || '');
    if (Number.isFinite(configured) && configured > 0) return configured;
    return this.contextLimit;
  }

  estimateTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      total += countTokens(msg.content);
      if (msg.role === 'system') total += 4;
      if (msg.toolCallId) total += 7;
      if (msg.images?.length) total += msg.images.length * 85;
    }
    total += 3;
    return total;
  }

  getStats(messages: Message[]): ContextStats {
    const totalTokens = this.estimateTokens(messages);
    const limit = this.getContextLimit();
    return {
      totalTokens,
      messageCount: messages.length,
      compactedCount: this.compactCount,
      estimatedPct: Math.round((totalTokens / limit) * 100),
    };
  }

  shouldCompact(messages: Message[]): boolean {
    if (messages.length < 10) return false;
    const tokens = this.estimateTokens(messages);
    return tokens > this.getContextLimit() * COMPACT_THRESHOLD;
  }

  private safeKeepFrom(messages: Message[], desired: number): number {
    let cutoff = Math.min(desired, messages.length - 1);
    const seenToolIds = new Set<string>();
    for (let i = cutoff; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'tool' && m.toolCallId) seenToolIds.add(m.toolCallId);
    }
    while (cutoff > 1) {
      const prev = messages[cutoff - 1];
      if (prev.role === 'assistant' && prev.toolCalls?.length) {
        const ids = prev.toolCalls.map((tc) => tc.id).filter(Boolean);
        if (ids.some((id) => seenToolIds.has(id))) {
          cutoff -= 1;
          continue;
        }
      }
      break;
    }
    return cutoff;
  }

  async compact(messages: Message[]): Promise<Message[]> {
    const systemMsg = messages[0];
    const keepFrom = this.safeKeepFrom(messages, Math.max(1, messages.length - 10));
    const toSummarize = messages.slice(1, keepFrom);
    const toKeep = messages.slice(keepFrom);

    if (toSummarize.length < 3) return messages;

    const conversationText = toSummarize
      .map((m) => {
        if (m.role === 'tool') return `[tool: ${m.toolCallId}] ${m.content.slice(0, 200)}`;
        if (m.role === 'assistant' && m.toolCalls?.length) {
          const toolNames = m.toolCalls.map((tc) => tc.name).join(', ');
          return `[assistant: used tools: ${toolNames}] ${m.content.slice(0, 300)}`;
        }
        return `[${m.role}]: ${m.content.slice(0, 500)}`;
      })
      .join('\n');

    const summary = await this.summarize(conversationText);

    this.compactCount++;

    const compactedMessages: Message[] = [
      systemMsg,
      {
        role: 'system',
        content: `[COMPACTED HISTORY - ${this.compactCount} compactions]\n${summary}\n[END COMPACTED HISTORY]`,
      },
      ...toKeep,
    ];

    return compactedMessages;
  }

  pruneToolResults(messages: Message[]): Message[] {
    const RECENT_KEEP = 6;
    const MAX_TOOL_RESULT = 12000;

    return messages.map((msg, i) => {
      if (msg.images && i < messages.length - RECENT_KEEP) {
        msg = { ...msg, images: undefined };
      }

      if (msg.role !== 'tool' || !msg.toolCallId) return msg;

      const isRecent = i >= messages.length - RECENT_KEEP;

      if (!isRecent && msg.content.includes('<persisted-output>')) {
        const filepathMatch = msg.content.match(/Full output saved to: (.+)/);
        const filepath = filepathMatch ? filepathMatch[1] : 'disk';
        return {
          ...msg,
          content: `[Old tool result persisted to ${filepath}. Use read_file to access if needed.]`,
        };
      }

      if (!isRecent && msg.content.length > MAX_TOOL_RESULT) {
        const head = msg.content.slice(0, 2000);
        const tail = msg.content.slice(msg.content.length - 2000);
        const omitted = msg.content.length - 4000;
        return {
          ...msg,
          content: `${head}\n\n... [${omitted} chars truncated from old tool result] ...\n\n${tail}`,
        };
      }

      if (!isRecent && msg.content.length > 200) {
        return {
          ...msg,
          content: `[old tool result: ${msg.toolCallId}] ${msg.content.slice(0, 150)}...`,
        };
      }

      return msg;
    });
  }

  trimOldMessages(messages: Message[], maxTokens?: number): Message[] {
    const limit = maxTokens || this.getContextLimit() * 0.6;
    const systemMsg = messages[0];
    const rest = messages.slice(1);

    let tokens = this.estimateTokens([systemMsg]);
    const kept: Message[] = [];

    for (let i = rest.length - 1; i >= 0; i--) {
      const msgTokens = countTokens(rest[i].content);
      if (tokens + msgTokens > limit && kept.length > 2) break;
      kept.unshift(rest[i]);
      tokens += msgTokens;
    }

    return [systemMsg, ...kept];
  }

  optimize(messages: Message[]): Message[] {
    let optimized = this.pruneToolResults(messages);
    optimized = this.trimOldMessages(optimized);
    return optimized;
  }

  private async summarize(text: string): Promise<string> {
    try {
      const res = await this.provider.chat([
        {
          role: 'system',
          content: `Summarize this conversation concisely. This summary replaces the full conversation history.

CRITICAL — preserve ALL of the following:
- Every file path mentioned (absolute paths, not relative)
- Key decisions made and why
- Tools used and their results (especially file edits, search results)
- Code patterns and architecture discovered
- Unresolved issues or pending tasks
- Any errors encountered and how they were resolved

Format as structured bullet points. Include file paths inline. Be thorough about WHAT was done, brief about HOW.`,
        },
        { role: 'user', content: text.slice(0, 12000) },
      ]);
      return res.text;
    } catch {
      return `[Summary unavailable - ${text.length} chars of conversation compacted]`;
    }
  }
}
