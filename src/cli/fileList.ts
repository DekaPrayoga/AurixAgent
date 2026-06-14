import * as fs from 'fs';
import * as path from 'path';

// Lists project files for the @-mention picker. Scans the cwd once (capped),
// skipping heavy/irrelevant dirs. Result is cached for the process lifetime.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', 'vendor', '__pycache__']);
const MAX_FILES = 4000;
const MAX_DEPTH = 8;

let cache: string[] | null = null;

export function listProjectFiles(root: string = process.cwd()): string[] {
  if (cache) return cache;
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.name.startsWith('.') && e.name !== '.env.example') continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        out.push(path.relative(root, path.join(dir, e.name)));
      }
    }
  };
  walk(root, 0);
  cache = out;
  return out;
}

export function clearFileCache(): void {
  cache = null;
}

// Fuzzy filter: every needle char appears in order; ranks shorter/earlier higher.
export function filterFiles(query: string, limit = 12, root?: string): string[] {
  const files = listProjectFiles(root);
  if (!query) return files.slice(0, limit);
  const n = query.toLowerCase();
  const scored: { f: string; s: number }[] = [];
  for (const f of files) {
    const h = f.toLowerCase();
    let hi = 0;
    let score = 0;
    let ok = true;
    let last = -1;
    for (const c of n) {
      const found = h.indexOf(c, hi);
      if (found === -1) { ok = false; break; }
      if (last !== -1) score += found - last;
      score += found;
      last = found;
      hi = found + 1;
    }
    if (ok) {
      // prefer matches in the basename
      if (path.basename(h).includes(n)) score -= 100;
      scored.push({ f, s: score });
    }
  }
  return scored.sort((a, b) => a.s - b.s).slice(0, limit).map(x => x.f);
}
