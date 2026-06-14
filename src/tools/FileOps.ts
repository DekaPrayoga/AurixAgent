import fs from 'fs';
import path from 'path';
import type { Tool } from './Registry.js';
import { getCheckpointEngine } from '../agent/Checkpoint.js';

export const readFileTool: Tool = {
  name: 'read_file',
  description: `Reads a file from the filesystem. You MUST read a file before editing it — the file_edit tool will reject edits to unread files. Use this tool to understand existing code before making changes. Supports reading specific line ranges with offset and limit parameters.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read' },
      offset: { type: 'number', description: 'Start line (1-based, default: 1)' },
      limit: { type: 'number', description: 'Max lines to read (default: 200)' },
    },
    required: ['path'],
  },
  async execute(args) {
    const filePath = path.resolve(args.path as string);
    const offset = ((args.offset as number) || 1) - 1;
    const limit = (args.limit as number) || 200;

    if (!fs.existsSync(filePath)) return `File not found: ${filePath}`;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const slice = lines.slice(offset, offset + limit);
    return slice.map((l, i) => `${offset + i + 1} | ${l}`).join('\n');
  },
};

export const writeFileTool: Tool = {
  name: 'write_file',
  description: `Writes content to a file. Creates the file if it does not exist, overwrites if it does. IMPORTANT: Prefer editing existing files using file_edit rather than creating new files. Only use write_file when creating genuinely new files or when a complete rewrite is necessary.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
  async execute(args) {
    const filePath = path.resolve(args.path as string);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    getCheckpointEngine()?.trackBeforeEdit(filePath);
    fs.writeFileSync(filePath, args.content as string, 'utf-8');
    return `Written ${(args.content as string).length} bytes to ${filePath}`;
  },
};

export const searchFilesTool: Tool = {
  name: 'search_files',
  description: `Search for a text pattern across files using ripgrep. Returns matching lines with file paths and line numbers. Use this tool to find where specific code, functions, routes, or patterns exist in the codebase. Essential for understanding project structure before making changes. Supports glob filtering to narrow results to specific file types.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory to search in (default: cwd)' },
      glob: { type: 'string', description: 'File glob pattern (e.g. "*.ts")' },
    },
    required: ['pattern'],
  },
  async execute(args) {
    const { execSync } = await import('child_process');
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) || '.';
    const glob = args.glob as string;

    let cmd = `rg --no-heading -n "${pattern}" "${searchPath}"`;
    if (glob) cmd += ` -g "${glob}"`;
    cmd += ' | head -50';

    try {
      return execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim() || 'No matches found';
    } catch {
      return 'No matches found or rg not available';
    }
  },
};
