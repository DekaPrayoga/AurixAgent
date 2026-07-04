import { loadConfig } from '../agent/Config.js';
import type { Tool } from './Registry.js';

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web. Configurable engine — DDG (free, default), Serper (Google), or Tavily (AI-optimized). Set in: aurix setup → Search Engine.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Max results (default: 5)' },
    },
    required: ['query'],
  },

  async execute(args) {
    const query = args.query as string;
    const maxResults = (args.max_results as number) || 5;
    const config = loadConfig();
    const engine = config.searchEngine || 'ddg';
    const apiKey = config.searchApiKey || process.env.SEARCH_API_KEY || process.env.TAVILY_API_KEY || '';

    if (engine === 'serper') return apiKey ? serperSearch(query, maxResults, apiKey) : noKey('Serper', 'https://serper.dev', 'SEARCH_API_KEY');
    if (engine === 'tavily') return apiKey ? tavilySearch(query, maxResults, apiKey) : noKey('Tavily', 'https://tavily.com', 'TAVILY_API_KEY');
    return duckduckgoSearch(query, maxResults);
  },
};

function noKey(name: string, url: string, envVar: string): string {
  return `🔑 ${name} needs an API key.\nGet one: ${url}\nSet: export ${envVar}="key"\nOr: aurix setup → Search Engine\n\nRetrying with DDG...`;
}

// ─── DuckDuckGo Instant Answer API (FREE, no key) ──────────────────────────

async function duckduckgoSearch(query: string, maxResults: number): Promise<string> {
  const results: string[] = [];

  // 1. DDG Instant Answer API
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'AurixAgent/3.0' } }
    );
    const data = await res.json() as any;

    if (data.AbstractText) {
      results.push(`📌 ${data.AbstractText}\n   Source: ${data.AbstractURL || 'DDG'}`);
    }

    for (const t of (data.RelatedTopics || []).filter((x: any) => x.Text && x.FirstURL).slice(0, maxResults)) {
      results.push(`${results.length + 1}. ${t.Text?.split(' - ')[0]?.slice(0, 100)}\n   ${t.FirstURL}\n   ${t.Text?.slice(0, 200) || ''}`);
    }
  } catch {}

  if (results.length >= Math.max(1, maxResults / 2)) {
    return results.join('\n\n') || `No results for "${query}".`;
  }

  // 2. DDG HTML fallback — multiple regex patterns for changing structure
  try {
    const params = new URLSearchParams({ q: query });
    const res = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();

    const patterns = [
      /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g,
      /<a[^>]*rel="nofollow"[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/span>/g,
      /<a[^>]*href="([^"]*uddg=[^"]*)"[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
    ];

    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(html)) !== null && results.length < maxResults + 2) {
        let url = match[1];
        const title = (match[2] || '').replace(/<[^>]*>/g, '').trim();
        const snippet = (match[3] || title).replace(/<[^>]*>/g, '').trim();
        const uddg = url.match(/uddg=([^&]+)/);
        if (uddg) url = decodeURIComponent(uddg[1]);
        if (title && url && !url.startsWith('//duckduckgo.com')) {
          results.push(`${results.length + 1}. ${title.slice(0, 100)}\n   ${url}\n   ${snippet.slice(0, 200)}`);
        }
      }
      if (results.length >= maxResults) break;
    }
  } catch {}

  // 3. SearXNG fallback
  if (results.length === 0) {
    const instances = ['https://searx.be', 'https://search.sapti.me', 'https://searxng.site', 'https://priv.au', 'https://search.hbubli.cc'];
    for (const ins of instances) {
      try {
        const r = await fetch(`${ins}/search?q=${encodeURIComponent(query)}&format=json`, {
          headers: { 'User-Agent': 'AurixAgent/3.0' },
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) continue;
        const d = await r.json() as any;
        for (const x of (d.results || []).slice(0, maxResults)) {
          results.push(`${results.length + 1}. ${x.title}\n   ${x.url}\n   ${(x.content || '').slice(0, 200)}`);
        }
        if (results.length > 0) break;
      } catch { continue; }
    }
  }

  return results.length > 0
    ? results.join('\n\n')
    : `No results for "${query}".\nTry: different keywords, browser tool, or set up Serper/Tavily API (aurix setup → Search Engine).`;
}

// ─── Serper.dev (Google results) ────────────────────────────────────────────

async function serperSearch(query: string, maxResults: number, apiKey: string): Promise<string> {
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: maxResults }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return `Serper: ${res.status === 403 ? 'Invalid API key. Get one at https://serper.dev' : `HTTP ${res.status}`}`;
    const data = await res.json() as any;
    const organic = data.organic || [];
    if (!organic.length) return `No results for "${query}".`;
    const parts: string[] = [];
    if (data.knowledgeGraph) parts.push(`📌 ${data.knowledgeGraph.title}: ${(data.knowledgeGraph.description || '').slice(0, 300)}`);
    parts.push(...organic.slice(0, maxResults).map((r: any, i: number) =>
      `${parts.length + 1}. ${r.title}\n   ${r.link}\n   ${(r.snippet || '').slice(0, 250)}`));
    return parts.join('\n\n');
  } catch (e: any) { return `Serper error: ${e.message}`; }
}

// ─── Tavily (AI-optimized) ──────────────────────────────────────────────────

async function tavilySearch(query: string, maxResults: number, apiKey: string): Promise<string> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, search_depth: 'basic' }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return `Tavily: ${res.status === 401 ? 'Invalid API key. Get one at https://tavily.com' : `HTTP ${res.status}`}`;
    const data = await res.json() as any;
    const results = data.results || [];
    if (!results.length) return `No results for "${query}".`;
    const parts: string[] = [];
    if (data.answer) parts.push(`📌 ${data.answer}`);
    parts.push(...results.slice(0, maxResults).map((r: any, i: number) =>
      `${parts.length + 1}. ${r.title}\n   ${r.url}\n   ${(r.content || '').slice(0, 250)}`));
    return parts.join('\n\n');
  } catch (e: any) { return `Tavily error: ${e.message}`; }
}
