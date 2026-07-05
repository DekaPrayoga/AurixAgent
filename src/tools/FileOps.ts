import fs from 'fs';
import path from 'path';
import type { Tool } from './Registry.js';
import { getCheckpointEngine } from '../agent/Checkpoint.js';
import { AskUserManager, globalAskCallback } from './AskUser.js';

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

async function confirmDelete(
  sessionKey: string,
  kind: 'file' | 'folder',
  targetPath: string
): Promise<boolean> {
  const answer = await AskUserManager.ask(
    sessionKey,
    `Delete ${kind}?\n${targetPath}\n\nReply yes to delete, no to cancel.`,
    ['yes', 'no'],
    (question, options) => globalAskCallback(sessionKey, question, options)
  );
  return /^(yes|y|ok|confirm|delete)$/i.test(answer.trim());
}

export const deleteFileTool: Tool = {
  name: 'delete_file',
  description: `Delete a single file after explicit user confirmation. Use this instead of rm/del/Remove-Item for file deletion. Never use terminal rm for deleting files.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to delete' },
      confirmed: {
        type: 'boolean',
        description: 'Set true only when user already explicitly approved deletion',
      },
    },
    required: ['path'],
  },
  async execute(args) {
    const filePath = path.resolve(args.path as string);
    if (!fs.existsSync(filePath)) return `File not found: ${filePath}`;
    if (!fs.statSync(filePath).isFile())
      return `Not a file: ${filePath}. Use delete_folder for directories.`;
    const sessionKey = (args._sessionKey as string) || 'default';
    if (!args.confirmed && !(await confirmDelete(sessionKey, 'file', filePath))) {
      return `Deletion cancelled for file: ${filePath}`;
    }
    getCheckpointEngine()?.trackBeforeEdit(filePath);
    fs.unlinkSync(filePath);
    return `Deleted file: ${filePath}`;
  },
};

export const deleteFolderTool: Tool = {
  name: 'delete_folder',
  description: `Delete a folder/directory recursively after explicit user confirmation. Use this instead of rm -rf/rmdir for folder deletion. Never use terminal rm -rf for deleting folders.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Folder path to delete' },
      confirmed: {
        type: 'boolean',
        description: 'Set true only when user already explicitly approved deletion',
      },
    },
    required: ['path'],
  },
  async execute(args) {
    const folderPath = path.resolve(args.path as string);
    if (!fs.existsSync(folderPath)) return `Folder not found: ${folderPath}`;
    if (!fs.statSync(folderPath).isDirectory())
      return `Not a folder: ${folderPath}. Use delete_file for files.`;
    const sessionKey = (args._sessionKey as string) || 'default';
    if (!args.confirmed && !(await confirmDelete(sessionKey, 'folder', folderPath))) {
      return `Deletion cancelled for folder: ${folderPath}`;
    }
    getCheckpointEngine()?.trackBeforeEdit(folderPath);
    fs.rmSync(folderPath, { recursive: true, force: true });
    return `Deleted folder: ${folderPath}`;
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
