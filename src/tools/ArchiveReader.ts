import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import type { Tool } from './Registry.js';

const MAX_ARCHIVE_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_EXTRACTED_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_FILE_COUNT = 1000;
const MAX_SINGLE_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const MAX_COMPRESSION_RATIO = 100; // 100:1 ratio indicates possible zip bomb
const MAX_NESTING_DEPTH = 5;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'php', 'swift', 'kt', 'scala', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
  'json', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'ini', 'cfg', 'conf',
  'sql', 'graphql', 'proto', 'dockerfile', 'makefile', 'cmake',
  'gitignore', 'gitattributes', 'editorconfig', 'env', 'example',
  'readme', 'license', 'changelog', 'authors', 'contributors',
  'log', 'diff', 'patch',
]);

const ARCHIVE_EXTENSIONS = new Set([
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'rar',
]);

function isTextFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase().slice(1);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(filename).toLowerCase();
  if (base === 'makefile' || base === 'dockerfile' || base === 'gemfile' || base === 'rakefile') return true;
  if (base.startsWith('.git') || base.startsWith('.docker')) return true;
  return false;
}

function getArchiveType(filePath: string): 'zip' | 'tar.gz' | 'tar.bz2' | 'tar' | 'rar' | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) return 'tar.bz2';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.rar')) return 'rar';
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function hasPathTraversal(entryPath: string): boolean {
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return true;
  const parts = entryPath.split(/[/\\]/);
  return parts.some(p => p === '..');
}

interface ArchiveEntry {
  path: string;
  size: number;
}

function listZip(filePath: string): ArchiveEntry[] {
  const output = execSync(`unzip -l "${filePath}"`, { encoding: 'utf-8', timeout: 30000 });
  const entries: ArchiveEntry[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+\d{2,4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/);
    if (match) {
      entries.push({ size: parseInt(match[1], 10), path: match[2].trim() });
    }
  }
  return entries;
}

function listTar(filePath: string, type: 'tar.gz' | 'tar.bz2' | 'tar'): ArchiveEntry[] {
  const flag = type === 'tar.gz' ? '-tzf' : type === 'tar.bz2' ? '-tjf' : '-tf';
  const output = execSync(`tar ${flag} "${filePath}"`, { encoding: 'utf-8', timeout: 30000 });
  const entries: ArchiveEntry[] = [];
  const names = output.split('\n').filter(Boolean);

  const verboseOutput = execSync(`tar ${flag.replace('-t', '-tv')} "${filePath}"`, { encoding: 'utf-8', timeout: 30000 });
  const vlines = verboseOutput.split('\n').filter(Boolean);

  for (const line of vlines) {
    const match = line.match(/^[^\s]+\s+\d+\/?\d*\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/);
    if (match) {
      entries.push({ size: parseInt(match[1], 10), path: match[2].trim() });
    }
  }

  if (entries.length === 0) {
    for (const name of names) {
      entries.push({ size: 0, path: name.trim() });
    }
  }

  return entries;
}

function listRar(filePath: string): ArchiveEntry[] {
  try {
    execSync('which unrar', { encoding: 'utf-8' });
  } catch {
    throw new Error('unrar is not installed. Install it with: apt install unrar (or equivalent)');
  }
  const output = execSync(`unrar v -c- "${filePath}"`, { encoding: 'utf-8', timeout: 30000 });
  const entries: ArchiveEntry[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*[\d.]+[KMG]?\s+\d+%\s+.*?\s+(\d+)\s+\d{2,4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/);
    if (match) {
      entries.push({ size: parseInt(match[1], 10), path: match[2].trim() });
    }
  }
  if (entries.length === 0) {
    const simpleOutput = execSync(`unrar lb "${filePath}"`, { encoding: 'utf-8', timeout: 30000 });
    for (const name of simpleOutput.split('\n').filter(Boolean)) {
      entries.push({ size: 0, path: name.trim() });
    }
  }
  return entries;
}

function validateEntries(entries: ArchiveEntry[], archiveSize: number): string | null {
  if (entries.length > MAX_FILE_COUNT) {
    return `Archive contains ${entries.length} files (limit: ${MAX_FILE_COUNT}). Possible zip bomb.`;
  }

  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);

  if (totalSize > MAX_EXTRACTED_SIZE) {
    return `Archive would extract to ${formatSize(totalSize)} (limit: ${formatSize(MAX_EXTRACTED_SIZE)}). Possible zip bomb.`;
  }

  if (archiveSize > 0 && totalSize / archiveSize > MAX_COMPRESSION_RATIO) {
    return `Compression ratio is ${(totalSize / archiveSize).toFixed(0)}:1 (limit: ${MAX_COMPRESSION_RATIO}:1). Possible zip bomb.`;
  }

  for (const entry of entries) {
    if (hasPathTraversal(entry.path)) {
      return `Path traversal detected in archive entry: "${entry.path}". Aborting for security.`;
    }
    if (entry.size > MAX_SINGLE_FILE_SIZE) {
      return `File "${entry.path}" is ${formatSize(entry.size)} (limit: ${formatSize(MAX_SINGLE_FILE_SIZE)}).`;
    }
  }

  return null;
}

function extractArchive(filePath: string, type: string, destDir: string): void {
  switch (type) {
    case 'zip':
      execSync(`unzip -q -o "${filePath}" -d "${destDir}"`, { timeout: 120000 });
      break;
    case 'tar.gz':
      execSync(`tar -xzf "${filePath}" -C "${destDir}"`, { timeout: 120000 });
      break;
    case 'tar.bz2':
      execSync(`tar -xjf "${filePath}" -C "${destDir}"`, { timeout: 120000 });
      break;
    case 'tar':
      execSync(`tar -xf "${filePath}" -C "${destDir}"`, { timeout: 120000 });
      break;
    case 'rar':
      execSync(`unrar x -o+ "${filePath}" "${destDir}/"`, { timeout: 120000 });
      break;
  }
}

function readExtractedFiles(destDir: string, maxLines: number, listOnly: boolean): string {
  const results: string[] = [];
  const fileList: string[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > MAX_NESTING_DEPTH) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(destDir, fullPath);
      if (entry.isDirectory()) {
        fileList.push(`${relativePath}/`);
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        fileList.push(`${relativePath} (${formatSize(stat.size)})`);
      }
    }
  }

  walk(destDir, 0);

  results.push('=== File Tree ===');
  results.push(fileList.join('\n'));

  if (listOnly) return results.join('\n');

  results.push('\n=== File Contents ===');

  function readFiles(dir: string, depth: number): void {
    if (depth > MAX_NESTING_DEPTH) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(destDir, fullPath);
      if (entry.isDirectory()) {
        readFiles(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        if (stat.size === 0) {
          results.push(`\n--- ${relativePath} (empty) ---`);
          continue;
        }
        if (isTextFile(entry.name) && stat.size < 10 * 1024 * 1024) {
          results.push(`\n--- ${relativePath} ---`);
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            const truncated = lines.slice(0, maxLines);
            results.push(truncated.join('\n'));
            if (lines.length > maxLines) {
              results.push(`... (${lines.length - maxLines} more lines truncated)`);
            }
          } catch {
            results.push('[Binary file - could not read as text]');
          }
        } else {
          results.push(`\n--- ${relativePath} [${isTextFile(entry.name) ? 'large text' : 'binary'} - ${formatSize(stat.size)}] ---`);
        }
      }
    }
  }

  readFiles(destDir, 0);

  return results.join('\n');
}

function cleanup(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

export const archiveReaderTool: Tool = {
  name: 'read_archive',
  description: `Reads the contents of an archive file (zip, tar.gz, tar.bz2, tar, rar). Extracts to a temporary directory, lists all files with sizes, and reads text file contents. Automatically cleans up temporary files after reading. Includes zip bomb protection (file count, size, and compression ratio limits). Use this when the user shares or references an archive file and wants to see what's inside.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the archive file' },
      max_lines: { type: 'number', description: 'Max lines to read per text file (default: 500)' },
      list_only: { type: 'boolean', description: 'Only list files without reading contents' },
    },
    required: ['path'],
  },

  async execute(args) {
    const filePath = path.resolve(args.path as string);
    const maxLines = (args.max_lines as number) || 500;
    const listOnly = args.list_only === true;

    if (!fs.existsSync(filePath)) {
      return `Error: File not found: ${filePath}`;
    }

    const type = getArchiveType(filePath);
    if (!type) {
      return `Error: Unsupported archive format. Supported: .zip, .tar.gz, .tgz, .tar.bz2, .tar, .rar`;
    }

    const stat = fs.statSync(filePath);
    if (stat.size > MAX_ARCHIVE_SIZE) {
      return `Error: Archive is ${formatSize(stat.size)} (limit: ${formatSize(MAX_ARCHIVE_SIZE)}).`;
    }

    let entries: ArchiveEntry[];
    try {
      switch (type) {
        case 'zip':
          entries = listZip(filePath);
          break;
        case 'tar.gz':
        case 'tar.bz2':
        case 'tar':
          entries = listTar(filePath, type);
          break;
        case 'rar':
          entries = listRar(filePath);
          break;
      }
    } catch (e: any) {
      return `Error listing archive contents: ${e.message}`;
    }

    const validationError = validateEntries(entries, stat.size);
    if (validationError) {
      return `Security check failed: ${validationError}`;
    }

    const tmpDir = path.join(os.tmpdir(), `aurix-archive-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      extractArchive(filePath, type, tmpDir);
      return readExtractedFiles(tmpDir, maxLines, listOnly);
    } catch (e: any) {
      return `Error extracting archive: ${e.message}`;
    } finally {
      cleanup(tmpDir);
    }
  },
};
