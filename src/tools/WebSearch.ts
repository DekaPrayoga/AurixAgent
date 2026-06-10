import type { Tool } from './Registry.js';

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web and return results. Use for finding information, articles, documentation, or any web content.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      max_results: {
        type: 'number',
        description: 'Max results to return (default: 5)',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = args.query as string;
    const maxResults = (args.max_results as number) || 5;

    const apiKey = process.env.TAVILY_API_KEY || process.env.SEARCH_API_KEY;

    if (apiKey) {
      return tavilySearch(query, maxResults, apiKey);
    }

    // Try DuckDuckGo HTML scraping first, then SearXNG fallback
    try {
      const results = await duckduckgoHtmlSearch(query, maxResults);
      if (results.length > 0) return results;
    } catch {}

    try {
      const results = await searxngSearch(query, maxResults);
      if (results.length > 0) return results;
    } catch {}

    return `No results found for "${query}". Try a different query or use the browser tool.`;
  },
};

async function tavilySearch(query: string, maxResults: number, apiKey: string): Promise<string> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: 'basic',
      }),
    });

    const data = await res.json() as any;
    const results = data.results || [];

    if (results.length === 0) return 'No results found.';

    return results.map((r: any, i: number) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content?.slice(0, 200) || ''}`
    ).join('\n\n');
  } catch (e: any) {
    return `Search error: ${e.message}`;
  }
}

async function duckduckgoHtmlSearch(query: string, maxResults: number): Promise<string> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Accept': 'text/html',
    },
  });

  const html = await res.text();
  const results: string[] = [];

  const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match;

  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    let url = match[1];
    const title = match[2].replace(/<[^>]*>/g, '').trim();
    const snippet = match[3].replace(/<[^>]*>/g, '').trim();

    // DDG wraps URLs in a redirect
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);

    if (title && snippet) {
      results.push(`${results.length + 1}. ${title}\n   ${url}\n   ${snippet}`);
    }
  }

  return results.join('\n\n');
}

async function searxngSearch(query: string, maxResults: number): Promise<string> {
  const instances = [
    'https://searx.be',
    'https://search.sapti.me',
    'https://searxng.site',
  ];

  for (const instance of instances) {
    try {
      const res = await fetch(`${instance}/search?q=${encodeURIComponent(query)}&format=json`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) continue;
      const data = await res.json() as any;
      const results = (data.results || []).slice(0, maxResults);

      if (results.length === 0) continue;

      return results.map((r: any, i: number) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${(r.content || '').slice(0, 200)}`
      ).join('\n\n');
    } catch {
      continue;
    }
  }

  return '';
}
