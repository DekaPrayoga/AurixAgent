import type { Tool } from './Registry.js';

export const gifSearchTool: Tool = {
  name: 'gif_search',
  description: 'Search for GIFs using Tenor API.',
  parameters: {
    type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default: 5)' },
      },
    required: ['query'],
  },
  async execute(args) {
    const query = args.query as string;
    const limit = (args.limit as number) || 5;
    const apiKey = process.env.TENOR_API_KEY;

    if (!apiKey) {
      return 'Tenor API key not set. Set TENOR_API_KEY environment variable.';
    }

    try {
      const res = await fetch(
        `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&limit=${limit}&key=${apiKey}&client_key=aurix`
      );
      const data = await res.json() as any;
      const gifs = (data.results || []).map((g: any) => ({
        title: g.content_description,
        url: g.media_formats?.gif?.url || g.media_formats?.tinygif?.url,
        mp4: g.media_formats?.mp4?.url,
      }));
      if (gifs.length === 0) return 'No GIFs found.';
      return gifs.map((g: any, i: number) => `${i + 1}. ${g.title}\n   GIF: ${g.url}\n   MP4: ${g.mp4}`).join('\n\n');
    } catch (e: any) {
      return `GIF search failed: ${e.message}`;
    }
  },
};
