import type { Tool } from './Registry.js';

export const youtubeTool: Tool = {
  name: 'youtube_transcript',
  description: 'Fetch a YouTube video transcript and optionally summarize it.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'YouTube video URL' },
      language: { type: 'string', description: 'Transcript language (default: en)' },
    },
    required: ['url'],
  },
  async execute(args) {
    const url = args.url as string;
    const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) return 'Invalid YouTube URL.';
    const videoId = match[1];

    try {
      // @ts-expect-error optional dependency
      const { YoutubeTranscript } = await import('youtube-transcript');
      const transcript = await YoutubeTranscript.fetchTranscript(videoId);
      const text = transcript.map((t: any) => t.text).join(' ');
      return `Transcript for ${videoId}:\n\n${text.slice(0, 5000)}`;
    } catch (e: any) {
      return `Transcript fetch failed: ${e.message}\nInstall: npm install youtube-transcript\n\nAlternatively, use web_search to find video information.`;
    }
  },
};
