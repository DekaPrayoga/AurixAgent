import type { ToolDef } from '../providers/index.js';

export interface ToolExecutionEvent {
  type: 'chunk';
  data: string;
  stream?: 'stdout' | 'stderr';
}

export interface ToolExecutionContext {
  onEvent?: (event: ToolExecutionEvent) => void;
}

export interface Tool {
  name: string;
  displayName?: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
  executeWithEvents?(args: Record<string, unknown>, context: ToolExecutionContext): Promise<string>;
}

export type PermissionMode = 'ask' | 'bypass' | 'deny';
export type PermissionReply = 'once' | 'always' | 'deny';
export type ToolHookEvent = 'preToolUse' | 'postToolUse' | 'toolFailure';
export type ToolHookDecision = 'allow' | 'deny' | 'ask' | 'defer';

export interface ToolHookRequest {
  event: ToolHookEvent;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  status?: 'success' | 'error';
  errorType?: string;
  sessionId?: string;
  turnId?: string;
}

export interface ToolHookResult {
  decision?: ToolHookDecision;
  reason?: string;
  message?: string;
}

export type ToolHookHandler = (
  request: ToolHookRequest
) => Promise<ToolHookResult> | ToolHookResult;

export interface ToolPermissionRequest {
  toolName: string;
  description: string;
  risk: 'read' | 'write' | 'execute' | 'network' | 'external';
  summary: string;
  arguments: Record<string, unknown>;
}

export type PermissionHandler = (request: ToolPermissionRequest) => Promise<PermissionReply>;

import { askInputUserTool, askUserTool } from './AskUser.js';
import {
  requiresManualDeleteApproval,
  requiresManualDependencyInstallApproval,
  requiresManualSensitiveToolApproval,
} from '../agent/DestructiveActionPolicy.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor() {
    this.register(askUserTool);
    this.register(askInputUserTool);
  }
  private allowedTools = new Set<string>();
  private permissionMode: PermissionMode = 'bypass';
  private permissionHandler?: PermissionHandler;
  private hookHandler?: ToolHookHandler;
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

  getPermissionHandler(): PermissionHandler | undefined {
    return this.permissionHandler;
  }

  setHookHandler(handler: ToolHookHandler): void {
    this.hookHandler = handler;
  }

  getHookHandler(): ToolHookHandler | undefined {
    return this.hookHandler;
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

  getToolDefs(toolNames?: Iterable<string>): ToolDef[] {
    const allowed = toolNames ? new Set(toolNames) : null;
    return this.list()
      .filter((t) => !allowed || allowed.has(t.name))
      .map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    return this.runTool(name, args);
  }

  async executeWithEvents(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext = {}
  ): Promise<string> {
    return this.runTool(name, args, context);
  }

  private async runHook(request: ToolHookRequest): Promise<ToolHookResult> {
    if (!this.hookHandler) return {};
    try {
      return (await this.hookHandler(request)) || {};
    } catch (e: any) {
      return { decision: 'deny', reason: e?.message || String(e) };
    }
  }

  private async runTool(
    name: string,
    args: Record<string, unknown>,
    context?: ToolExecutionContext
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Error: Unknown tool "${name}"`;

    const hookBase = {
      toolName: name,
      args: redactArgs(args),
      sessionId: typeof args._sessionId === 'string' ? args._sessionId : undefined,
      turnId: typeof args._turnId === 'string' ? args._turnId : undefined,
    };
    const preHook = await this.runHook({ event: 'preToolUse', ...hookBase });
    if (preHook.decision === 'deny') {
      return `Permission denied for ${name} by hook${preHook.reason ? `: ${preHook.reason}` : '.'}`;
    }
    if (preHook.decision === 'defer') {
      return `Tool ${name} deferred by hook${preHook.reason ? `: ${preHook.reason}` : '.'}`;
    }
    const hookForcesAsk = preHook.decision === 'ask';

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
    const manualDeleteApproval = requiresManualDeleteApproval(name);
    const dependencyInstallApproval = requiresManualDependencyInstallApproval(name, args);
    const sensitiveToolApproval = requiresManualSensitiveToolApproval(name, args);
    const manualApproval =
      manualDeleteApproval || Boolean(dependencyInstallApproval) || Boolean(sensitiveToolApproval);
    if (manualDeleteApproval) {
      delete args.confirmed;
      delete args._approvedByUser;
    }
    if (dependencyInstallApproval) {
      delete args._approvedDependencyInstall;
    }
    if (permission && (manualApproval || hookForcesAsk || !this.allowedTools.has(name))) {
      if (this.permissionMode === 'deny' && !manualApproval && !hookForcesAsk) {
        return `Permission denied for ${name}. Use /permissions mode ask to allow prompts.`;
      }

      if (manualApproval || hookForcesAsk || this.permissionMode !== 'bypass') {
        if (!this.permissionHandler) {
          return `Permission required for ${name}, but no interactive permission handler is available.`;
        }

        const manualPermission = dependencyInstallApproval
          ? {
              ...permission,
              risk: 'execute' as const,
              summary: `${dependencyInstallApproval.reason}: ${dependencyInstallApproval.command}`,
              arguments: {
                ...permission.arguments,
                dependencyInstall: dependencyInstallApproval,
              },
            }
          : sensitiveToolApproval
            ? {
                ...permission,
                risk: 'execute' as const,
                summary: `${sensitiveToolApproval.reason}: ${sensitiveToolApproval.command}`,
                arguments: {
                  ...permission.arguments,
                  sensitiveAction: sensitiveToolApproval,
                },
              }
            : permission;
        const reply = await this.permissionHandler(manualPermission);
        if (reply === 'deny') return `Permission denied for ${name}.`;
        if (manualDeleteApproval) args._approvedByUser = true;
        if (dependencyInstallApproval) args._approvedDependencyInstall = true;
        if (!manualApproval && reply === 'always') this.allowedTools.add(name);
      }
    }

    try {
      const result =
        context && tool.executeWithEvents
          ? await tool.executeWithEvents(args, context)
          : await tool.execute(args);
      const postHook = await this.runHook({
        event: 'postToolUse',
        ...hookBase,
        result: result.slice(0, 4000),
        status: 'success',
      });
      if (postHook.decision === 'deny') {
        return `Error: ${name} result rejected by hook${postHook.reason ? `: ${postHook.reason}` : '.'}`;
      }
      return postHook.message ? `${result}\n\n[Hook] ${postHook.message}` : result;
    } catch (e: any) {
      const result = `Error executing ${name}: ${e.message}`;
      const failureHook = await this.runHook({
        event: 'toolFailure',
        ...hookBase,
        result,
        status: 'error',
        errorType: e?.name || 'tool_error',
      });
      return failureHook.message ? `${result}\n\n[Hook] ${failureHook.message}` : result;
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
  if (name === 'terminal' || name === 'code_exec' || name === 'docker_manage' || name === 'vps')
    return 'execute';
  if (name === 'git_advanced') return 'external';
  if (name.startsWith('gh_') || name.startsWith('github_')) return 'external';
  if (name === 'email') {
    return args.action === 'send' ? 'external' : 'network';
  }
  if (name === 'temp_mailing') return 'network';
  if (
    name.includes('deploy') ||
    name.includes('cloud') ||
    name.includes('docker') ||
    name.includes('vps') ||
    name.includes('browser') ||
    name.includes('web_search') ||
    name.includes('research') ||
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
  if (
    name === 'write_file' ||
    name === 'read_file' ||
    name === 'delete_file' ||
    name === 'delete_folder'
  )
    return String(args.path || '').slice(0, 180);
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
