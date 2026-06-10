import fs from 'fs';
import path from 'path';
import type { Tool } from './Registry.js';

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file. Supports text files. Returns content with line numbers.',
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
  description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
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
    fs.writeFileSync(filePath, args.content as string, 'utf-8');
    return `Written ${(args.content as string).length} bytes to ${filePath}`;
  },
};

export const searchFilesTool: Tool = {
  name: 'search_files',
  description: 'Search for a pattern in files using ripgrep (rg) or grep. Returns matching lines with file paths.',
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
