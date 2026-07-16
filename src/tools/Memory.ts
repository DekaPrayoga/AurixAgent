import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from './Registry.js';
import { MemoryEngine } from '../agent/MemoryEngine.js';
import { getSessionStore, type SessionSummary } from '../agent/SessionStore.js';
import type { Provider } from '../providers/index.js';

const engine = new MemoryEngine();

function formatSessionHits(hits: SessionSummary[]): string {
  if (hits.length === 0) return '';
  return hits
    .map(
      (hit, i) =>
        `SESSION ${i + 1}: ${hit.id} — ${hit.preview || hit.snippet || '(empty)'} (${hit.messageCount} msg)`
    )
    .join('\n');
}

async function searchDurableSessions(query: string): Promise<string> {
  try {
    const store = await getSessionStore();
    return formatSessionHits(store.searchSessions(query, 8));
  } catch {
    return '';
  }
}

// Called by AgentLoop on startup so the memory tool can use the active
// provider to rephrase user input into context-dense memories.
export function setMemoryProvider(p: Provider | undefined): void {
  engine.setProvider(p);
}

export const memoryTool: Tool = {
  name: 'memory',
  description:
    "Persistent memory across sessions. Remember facts, preferences, and context. Use to store important info so you don't lose context between conversations.",
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: remember, recall, search, forget, list, consolidate, stats',
      },
      content: {
        type: 'string',
        description:
          'Content to remember (for remember action). Will be auto-enriched before saving.',
      },
      tags: {
        type: 'string',
        description: 'Comma-separated tags for categorization',
      },
      query: {
        type: 'string',
        description: 'Search query (for search/recall action)',
      },
      raw: {
        type: 'string',
        description: 'Set to "true" to skip the auto-enrichment step and save content verbatim.',
      },
    },
    required: ['action'],
  },
  async execute(args) {
    let action = String(args.action || '').trim();
    const knownActions = new Set([
      'remember',
      'recall',
      'search',
      'forget',
      'list',
      'consolidate',
      'stats',
    ]);
    const inferredQuery = [args.query, !knownActions.has(action) ? action : '', args.content]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ');
    if (!knownActions.has(action)) action = inferredQuery ? 'search' : 'list';

    switch (action) {
      case 'remember': {
        const rawContent = args.content as string;
        if (!rawContent) return 'Error: provide content to remember';
        const skipRephrase = (args.raw as string) === 'true';
        const enriched = skipRephrase ? rawContent : await engine.rephraseForMemory(rawContent);
        engine.appendRaw(enriched);
        const wasEnriched = enriched !== rawContent;
        return wasEnriched
          ? `Remembered (enriched):\n  Original: ${rawContent.slice(0, 100)}${rawContent.length > 100 ? '...' : ''}\n  Stored:   ${enriched.slice(0, 300)}${enriched.length > 300 ? '...' : ''}`
          : `Remembered: ${rawContent.slice(0, 100)}${rawContent.length > 100 ? '...' : ''}`;
      }

      case 'recall':
      case 'search': {
        const query = inferredQuery.toLowerCase();
        if (!query) {
          const summary = engine.loadSummary();
          return (
            summary || 'No memories stored yet. Use `memory remember <content>` to save facts.'
          );
        }
        const memoryResults = engine.searchMemory(query);
        const sessionResults = await searchDurableSessions(query);
        const results = [
          memoryResults,
          sessionResults && `Durable session history:\n${sessionResults}`,
        ]
          .filter(Boolean)
          .join('\n');
        return results || `No memories or durable sessions matching "${query}"`;
      }

      case 'list': {
        const stats = engine.getStats();
        const summary = engine.loadSummary();
        return `Memory stats:\n  Summary: ${stats.summarySize} bytes\n  Raw: ${stats.rawSize} bytes\n  Full memory: ${stats.memorySize} bytes\n  Sessions: ${stats.sessionCount}\n\nLatest summary:\n${summary || '(empty)'}`;
      }

      case 'consolidate': {
        await engine.consolidate();
        await engine.mergeMemories();
        engine.purgeOldSessions();
        return 'Memory consolidated and old sessions purged.';
      }

      case 'stats': {
        const stats = engine.getStats();
        return `Memory stats:\n  Summary: ${stats.summarySize} bytes\n  Raw: ${stats.rawSize} bytes\n  Full memory: ${stats.memorySize} bytes\n  Sessions: ${stats.sessionCount}`;
      }

      default:
        return `Unknown action: ${action}. Use: remember, recall, search, list, consolidate, stats`;
    }
  },
};
