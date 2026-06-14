import type { Tool } from './Registry.js';

export const scraperTool: Tool = {
  name: 'web_scrape',
  description: 'Scrape a web page and extract structured data.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to scrape' },
      selector: { type: 'string', description: 'CSS selector to target (e.g. "h1", ".article", "table")' },
      extract: { type: 'string', description: 'What to extract: text, html, links, images, table' },
      max_pages: { type: 'number', description: 'Max pages to follow (default: 1)' },
    },
    required: ['url'],
  },
  async execute(args) {
    const url = args.url as string;
    const extract = (args.extract as string) || 'text';
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'AURIX-Agent/0.1' } });
      const html = await res.text();

      if (extract === 'text') {
        const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 5000);
        return `Scraped: ${url}\n\n${text}`;
      }

      if (extract === 'links') {
        const links: string[] = [];
        const re = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
          links.push(`${m[2].replace(/<[^>]+>/g, '').trim()} -> ${m[1]}`);
        }
        return `Links from ${url} (${links.length}):\n${links.slice(0, 50).join('\n')}`;
      }

      if (extract === 'images') {
        const images: string[] = [];
        const re = /<img\s[^>]+>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
          const tag = m[0];
          const srcMatch = tag.match(/src="([^"]+)"/i);
          const altMatch = tag.match(/alt="([^"]*)"/i);
          if (srcMatch) {
            images.push(`${altMatch?.[1] || 'no alt'} -> ${srcMatch[1]}`);
          }
        }
        return `Images from ${url} (${images.length}):\n${images.slice(0, 30).join('\n')}`;
      }

      return `Scraped ${url} (mode: ${extract}). Raw HTML length: ${html.length}`;
    } catch (e: any) {
      return `Scrape failed: ${e.message}`;
    }
  },
};
