import type { ToolDef } from '../providers/index.js';

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
}

export type PermissionMode = 'ask' | 'bypass' | 'deny';
export type PermissionReply = 'once' | 'always' | 'deny';

export interface ToolPermissionRequest {
  toolName: string;
  description: string;
  risk: 'read' | 'write' | 'execute' | 'network' | 'external';
  summary: string;
  arguments: Record<string, unknown>;
}

export type PermissionHandler = (request: ToolPermissionRequest) => Promise<PermissionReply>;

import { askUserTool } from './AskUser.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor() {
    this.register(askUserTool);
  }
  private allowedTools = new Set<string>();
  private permissionMode: PermissionMode = 'bypass';
  private permissionHandler?: PermissionHandler;
  private readFiles = new Set<string>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  setPermissionHandler(handler: PermissionHandler): void {
    this.permissionHandler = handler;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  clearPermissionRules(): void {
    this.allowedTools.clear();
  }

  clearReadFiles(): void {
    this.readFiles.clear();
  }

  listPermissionRules(): string[] {
    return Array.from(this.allowedTools.values()).sort();
  }

  getToolDefs(): ToolDef[] {
    return this.list().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Error: Unknown tool "${name}"`;

    const filePath = (args.file_path || args.path) as string | undefined;

    if (name === 'read_file' && filePath) {
      this.readFiles.add(filePath);
    }

    if (name === 'file_edit' && filePath) {
      const isNewFile = args.old_string === '';
      if (!isNewFile && !this.readFiles.has(filePath)) {
        return `Error: File "${filePath}" has not been read yet. You MUST use read_file to read it first before editing. No exceptions.`;
      }
    }

    const permission = this.getPermissionRequest(tool, args);
    if (permission && !this.allowedTools.has(name)) {
      if (this.permissionMode === 'deny') {
        return `Permission denied for ${name}. Use /permissions mode ask to allow prompts.`;
      }

      if (this.permissionMode !== 'bypass') {
        if (!this.permissionHandler) {
          return `Permission required for ${name}, but no interactive permission handler is available.`;
        }

        const reply = await this.permissionHandler(permission);
        if (reply === 'deny') return `Permission denied for ${name}.`;
        if (reply === 'always') this.allowedTools.add(name);
      }
    }

    try {
      return await tool.execute(args);
    } catch (e: any) {
      return `Error executing ${name}: ${e.message}`;
    }
  }

  private getPermissionRequest(
    tool: Tool,
    args: Record<string, unknown>
  ): ToolPermissionRequest | null {
    const risk = classifyRisk(tool.name, args);
    if (!risk) return null;

    return {
      toolName: tool.name,
      description: tool.description,
      risk,
      summary: summarizeToolUse(tool.name, args),
      arguments: redactArgs(args),
    };
  }
}

function classifyRisk(
  name: string,
  args: Record<string, unknown>
): ToolPermissionRequest['risk'] | null {
  if (name === 'read_file' || name === 'search_files') return 'read';
  if (name === 'write_file' || name === 'delete_file' || name === 'delete_folder') return 'write';
  if (name === 'terminal' || name === 'code_exec') return 'execute';
  if (name === 'git_advanced') return 'external';
  if (name.startsWith('gh_') || name.startsWith('github_')) return 'external';
  if (name === 'email') {
    return args.action === 'send' ? 'external' : 'network';
  }
  if (
    name.includes('deploy') ||
    name.includes('cloud') ||
    name.includes('docker') ||
    name.includes('vps') ||
    name.includes('browser') ||
    name.includes('web_search') ||
    name.includes('scraper')
  ) {
    return 'network';
  }
  return null;
}

function summarizeToolUse(name: string, args: Record<string, unknown>): string {
  if (name === 'terminal') return String(args.command || '');
  if (name === 'code_exec') {
    const lang = args.language || 'python';
    const code = String(args.code || '');
    return `[${lang}] ${code}`;
  }
  if (name === 'write_file' || name === 'read_file') return String(args.path || '').slice(0, 180);
  if (name === 'search_files') return `${args.pattern || ''} in ${args.path || '.'}`.slice(0, 180);
  if (name === 'email') return `${args.action || 'email'} ${args.to ? `to ${args.to}` : ''}`.trim();
  if (name.startsWith('gh_')) return JSON.stringify(redactArgs(args)).slice(0, 180);
  return JSON.stringify(redactArgs(args)).slice(0, 180);
}

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (/key|token|secret|password|authorization/i.test(key)) {
      out[key] = '[redacted]';
    } else if (typeof value === 'string' && value.length > 600) {
      out[key] = value.slice(0, 600) + '...';
    } else {
      out[key] = value;
    }
  }
  return out;
}
