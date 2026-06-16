import fs from 'fs';
import path from 'path';
import os from 'os';

const CACHE_DIR = path.join(os.homedir(), '.aurix', 'mcp');
const CACHE_FILE = path.join(CACHE_DIR, 'catalog-cache.json');
const CACHE_TTL = 24 * 60 * 60 * 1000;

export interface CatalogEntry {
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  category: string;
  url?: string;
}

interface CatalogCache {
  fetchedAt: number;
  entries: CatalogEntry[];
}

function ensureDirs(): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export async function fetchCatalog(): Promise<CatalogEntry[]> {
  ensureDirs();

  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cache: CatalogCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      if (Date.now() - cache.fetchedAt < CACHE_TTL) return cache.entries;
    }
  } catch {}

  const entries = await fetchFromGithub();
  if (entries.length > 0) {
    const cache: CatalogCache = { fetchedAt: Date.now(), entries };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  }

  return entries.length > 0 ? entries : getBuiltinCatalog();
}

async function fetchFromGithub(): Promise<CatalogEntry[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(
      'https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md',
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (!res.ok) return [];
    const text = await res.text();
    return parseReadmeCatalog(text);
  } catch {
    return [];
  }
}

function parseReadmeCatalog(readme: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const lines = readme.split('\n');
  let currentCategory = 'General';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^###?\s+(.+)/);
    if (headerMatch) {
      currentCategory = headerMatch[1].trim().replace(/[#*]/g, '');
      continue;
    }

    const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)\s*[-:]\s*(.+)/);
    if (linkMatch) {
      const [, name, url, desc] = linkMatch;
      const npxName = extractNpxPackage(url, name);
      if (npxName) {
        entries.push({
          name: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          description: desc.trim().replace(/\s+/g, ' ').slice(0, 120),
          command: 'npx',
          args: ['-y', npxName],
          category: currentCategory,
          url,
        });
      }
    }
  }

  return entries;
}

function extractNpxPackage(url: string, name: string): string | null {
  const ghMatch = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (ghMatch) {
    const repo = ghMatch[1].toLowerCase();
    if (repo.includes('mcp')) return `@modelcontextprotocol/server-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }
  if (url.includes('npmjs.com/package/')) {
    const pkgMatch = url.match(/npmjs\.com\/package\/([^/]+)/);
    if (pkgMatch) return pkgMatch[1];
  }
  return null;
}

function getBuiltinCatalog(): CatalogEntry[] {
  return [
    { name: 'github', description: 'GitHub repos, PRs, issues, actions', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' }, category: 'Development' },
    { name: 'filesystem', description: 'Filesystem read/write/search', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', os.homedir()], category: 'System' },
    { name: 'postgres', description: 'PostgreSQL database queries', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { DATABASE_URL: '' }, category: 'Database' },
    { name: 'sqlite', description: 'SQLite database queries', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sqlite'], env: { SQLITE_DB_PATH: '' }, category: 'Database' },
    { name: 'brave_search', description: 'Brave web search', command: 'npx', args: ['-y', '@anthropic/mcp-server-brave-search'], env: { BRAVE_API_KEY: '' }, category: 'Search' },
    { name: 'puppeteer', description: 'Browser automation', command: 'npx', args: ['-y', '@anthropic/mcp-server-puppeteer'], category: 'Browser' },
    { name: 'slack', description: 'Slack channels and messages', command: 'npx', args: ['-y', '@anthropic/mcp-server-slack'], env: { SLACK_BOT_TOKEN: '' }, category: 'Communication' },
    { name: 'memory', description: 'Persistent knowledge graph', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], category: 'AI' },
    { name: 'fetch', description: 'Fetch and parse web pages', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'], category: 'Web' },
    { name: 'sequential_thinking', description: 'Step-by-step reasoning', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], category: 'AI' },
  ];
}

export function searchCatalog(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.toLowerCase();
  return entries.filter(e =>
    e.name.includes(q) || e.description.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)
  );
}
