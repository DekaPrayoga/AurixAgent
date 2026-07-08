import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { RepoBrainEntry, RepoBrainIndex } from './types.js';

const INCLUDE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.cjs',
  '.mjs',
]);
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.aurix',
  '.claude',
  'coverage',
  '.next',
  'build',
]);
const MAX_FILE_SIZE = 256 * 1024;

function cacheFile(root: string, stateDir?: string): string {
  const base = stateDir || path.join(os.homedir(), '.aurix', 'state', 'repo-brain');
  const hash = crypto.createHash('sha1').update(root).digest('hex');
  return path.join(base, `${hash}.json`);
}

function detectKind(file: string): RepoBrainEntry['kind'] {
  const lower = file.toLowerCase();
  if (/(__tests__|\.test\.|\.spec\.|tests?\/)/.test(lower)) return 'test';
  if (/\.md$/.test(lower)) return 'docs';
  if (/(package\.json|tsconfig|\.ya?ml$|\.json$|config)/.test(lower)) return 'config';
  if (/(scripts?\/|\.cjs$|\.mjs$)/.test(lower)) return 'script';
  if (/\.(tsx?|jsx?)$/.test(lower)) return 'source';
  return 'unknown';
}

function detectLanguage(file: string): string | undefined {
  const ext = path.extname(file).toLowerCase();
  return {
    '.ts': 'typescript',
    '.tsx': 'typescript-react',
    '.js': 'javascript',
    '.jsx': 'javascript-react',
    '.json': 'json',
    '.md': 'markdown',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.cjs': 'javascript',
    '.mjs': 'javascript',
  }[ext];
}

function extractImports(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(/import\s+(?:[^'\"]+\s+from\s+)?['\"]([^'\"]+)['\"]/g))
    out.add(match[1]);
  for (const match of text.matchAll(/require\(['\"]([^'\"]+)['\"]\)/g)) out.add(match[1]);
  return [...out].slice(0, 20);
}

function extractSymbols(text: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    /export\s+class\s+([A-Za-z0-9_]+)/g,
    /export\s+interface\s+([A-Za-z0-9_]+)/g,
    /export\s+type\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) out.add(match[1]);
  }
  return [...out].slice(0, 30);
}

function summarizeFile(file: string, text: string, symbols: string[], imports: string[]): string {
  if (file.endsWith('.md')) {
    const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1];
    if (heading) return heading.slice(0, 180);
  }
  const firstComment = text
    .match(/\/\*\*?\s*([\s\S]{20,240}?)\s*\*\//)?.[1]
    ?.replace(/\s*\*\s?/g, ' ');
  if (firstComment) return firstComment.replace(/\s+/g, ' ').slice(0, 180);
  if (symbols.length) return `Exports ${symbols.slice(0, 8).join(', ')}`;
  if (imports.length) return `Imports ${imports.slice(0, 5).join(', ')}`;
  return text.replace(/\s+/g, ' ').trim().slice(0, 180) || '(empty)';
}

export class RepoBrain {
  private index?: RepoBrainIndex;

  constructor(
    private root: string,
    private options: { stateDir?: string; maxFiles?: number } = {}
  ) {}

  loadOrBuild(): RepoBrainIndex {
    if (this.index) return this.index;
    const file = cacheFile(this.root, this.options.stateDir);
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RepoBrainIndex;
        if (parsed.version === 1 && parsed.root === this.root) {
          this.index = parsed;
          return parsed;
        }
      }
    } catch {}
    return this.rebuild();
  }

  rebuild(): RepoBrainIndex {
    const entries: RepoBrainEntry[] = [];
    const maxFiles = this.options.maxFiles || 400;

    const walk = (dir: string) => {
      if (entries.length >= maxFiles) return;
      let items: fs.Dirent[] = [];
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items) {
        if (entries.length >= maxFiles) return;
        if (item.name.startsWith('.') && item.name !== '.github' && SKIP_DIRS.has(item.name))
          continue;
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          if (!SKIP_DIRS.has(item.name)) walk(full);
          continue;
        }
        if (!item.isFile()) continue;
        const ext = path.extname(item.name).toLowerCase();
        if (!INCLUDE_EXTS.has(ext)) continue;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (stat.size > MAX_FILE_SIZE) continue;
        try {
          const text = fs.readFileSync(full, 'utf8');
          if (text.includes('\0')) continue;
          const rel = path.relative(this.root, full).replace(/\\/g, '/');
          const symbols = extractSymbols(text);
          const imports = extractImports(text);
          entries.push({
            path: rel,
            kind: detectKind(rel),
            language: detectLanguage(rel),
            symbols,
            imports,
            summary: summarizeFile(rel, text, symbols, imports),
            mtimeMs: stat.mtimeMs,
            size: stat.size,
          });
        } catch {}
      }
    };

    walk(this.root);
    this.index = { root: this.root, version: 1, generatedAt: new Date().toISOString(), entries };
    try {
      const file = cacheFile(this.root, this.options.stateDir);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.index, null, 2), 'utf8');
    } catch {}
    return this.index;
  }

  search(query: string, limit = 8): RepoBrainEntry[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const entries = this.loadOrBuild().entries;
    return entries
      .map((entry) => {
        const haystack =
          `${entry.path} ${entry.kind} ${entry.language || ''} ${entry.symbols.join(' ')} ${entry.imports.join(' ')} ${entry.summary}`.toLowerCase();
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
      .slice(0, limit)
      .map((item) => item.entry);
  }

  summarize(limitChars = 2200): string {
    const index = this.loadOrBuild();
    const byKind = new Map<string, number>();
    for (const entry of index.entries) byKind.set(entry.kind, (byKind.get(entry.kind) || 0) + 1);
    const important = index.entries
      .filter((e) => e.kind === 'source' || e.kind === 'config')
      .slice(0, 20)
      .map((e) => `- ${e.path}: ${e.summary}`)
      .join('\n');
    const text = `Repo index: ${index.entries.length} files (${[...byKind.entries()].map(([k, v]) => `${k}:${v}`).join(', ')})\n${important}`;
    return text.length > limitChars ? `${text.slice(0, limitChars)}\n...` : text;
  }
}
