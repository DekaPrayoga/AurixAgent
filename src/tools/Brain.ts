import type { Tool } from './Registry.js';
import type { AurixBrain } from '../brain/AurixBrain.js';

let currentBrain: AurixBrain | undefined;

export function setBrainInstance(brain: AurixBrain): void {
  currentBrain = brain;
}

export const brainTool: Tool = {
  name: 'brain',
  description:
    'Inspect Aurix Brain context: model capabilities, repo index summary/search, and transient scratchpad.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['summary', 'search-repo', 'index-repo', 'scratchpad', 'capabilities'],
        description: 'Brain action to run.',
      },
      query: { type: 'string', description: 'Search query for search-repo.' },
      limit: { type: 'number', description: 'Maximum result count.' },
    },
    required: ['action'],
  },
  async execute(args) {
    if (!currentBrain) return 'Brain is not initialized yet.';
    const action = String(args.action || 'summary');
    switch (action) {
      case 'capabilities':
        return JSON.stringify(currentBrain.getCapabilities(), null, 2);
      case 'scratchpad':
        return JSON.stringify(currentBrain.getScratchpadState(), null, 2);
      case 'index-repo':
        return currentBrain.rebuildRepoIndex();
      case 'search-repo': {
        const query = String(args.query || '').trim();
        if (!query) return 'search-repo requires query.';
        const rows = currentBrain.searchRepo(query, Number(args.limit || 8));
        if (!rows.length) return `No repo brain matches for: ${query}`;
        return rows.map((row) => `- ${row.path} (${row.kind}): ${row.summary}`).join('\n');
      }
      case 'summary':
      default:
        return currentBrain.buildTransientContext() || 'Brain context is empty.';
    }
  },
};
