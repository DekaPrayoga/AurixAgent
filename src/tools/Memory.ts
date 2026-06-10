import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from './Registry.js';
import { MemoryEngine } from '../agent/MemoryEngine.js';

const engine = new MemoryEngine();

export const memoryTool: Tool = {
  name: 'memory',
  description: 'Persistent memory across sessions. Remember facts, preferences, and context. Use to store important info so you don\'t lose context between conversations.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: remember, recall, search, forget, list, consolidate, stats',
      },
      content: {
        type: 'string',
        description: 'Content to remember (for remember action)',
      },
      tags: {
        type: 'string',
        description: 'Comma-separated tags for categorization',
      },
      query: {
        type: 'string',
        description: 'Search query (for search/recall action)',
      },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = args.action as string;

    switch (action) {
      case 'remember': {
        const content = args.content as string;
        if (!content) return 'Error: provide content to remember';
        engine.appendRaw(content);
        return `Remembered: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`;
      }

      case 'recall':
      case 'search': {
        const query = (args.query as string || '').toLowerCase();
        if (!query) {
          const summary = engine.loadSummary();
          return summary || 'No memories stored yet. Use `memory remember <content>` to save facts.';
        }
        const results = engine.searchMemory(query);
        return results || `No memories matching "${query}"`;
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
