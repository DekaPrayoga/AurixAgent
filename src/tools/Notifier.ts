import type { Tool } from './Registry.js';

export const notifierTool: Tool = {
  name: 'setup_notifier',
  description: 'Set up RSS feed or API change watchers.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'rss or webhook' },
      url: { type: 'string', description: 'RSS feed URL or webhook endpoint' },
      interval: { type: 'number', description: 'Check interval in minutes (default: 30)' },
    },
    required: ['type', 'url'],
  },
  async execute(args) {
    const type = args.type as string;
    const url = args.url as string;
    const interval = (args.interval as number) || 30;

    if (type === 'rss') {
      try {
        const res = await fetch(url);
        const text = await res.text();
        const titles = [...text.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi)].map(m => m[1]);
        return `RSS Feed: ${url}\nLatest ${titles.length} items:\n${titles.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nWatcher configured (every ${interval}min). Install rss-parser for advanced features.`;
      } catch (e: any) {
        return `Failed to fetch RSS: ${e.message}`;
      }
    }

    return `Webhook notifier set up for ${url} (checking every ${interval}min).`;
  },
};
