import { spawnSync } from 'child_process';
import type { AurixConfig } from './Config.js';

export type ToolHookEvent =
  | 'preToolUse'
  | 'postToolUse'
  | 'toolFailure'
  | 'preCompact'
  | 'postCompact';
export type ToolDecision = 'allow' | 'deny' | 'ask' | 'defer';

export interface ToolHookInput {
  event: ToolHookEvent;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: string;
  status?: string;
  errorType?: string;
  sessionId?: string;
  turnId?: string;
  summary?: string;
}

export interface ToolHookResult {
  decision?: ToolDecision;
  reason?: string;
  message?: string;
}

interface HookConfig {
  command?: string;
  timeoutMs?: number;
}

function hookConfig(config: AurixConfig, event: ToolHookEvent): HookConfig | undefined {
  const hooks = config.hooks as any;
  const raw = hooks?.[event];
  if (!raw) return undefined;
  if (typeof raw === 'string') return { command: raw };
  if (typeof raw === 'object' && typeof raw.command === 'string') return raw;
  return undefined;
}

function parseHookResult(stdout: string): ToolHookResult {
  const text = stdout.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  return { message: text.slice(0, 1000) };
}

export function runToolHook(config: AurixConfig, input: ToolHookInput): ToolHookResult {
  const cfg = hookConfig(config, input.event);
  if (!cfg?.command) return {};

  const child = spawnSync(cfg.command, {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    shell: true,
    timeout: cfg.timeoutMs || 10_000,
    env: { ...process.env, AURIX_HOOK_EVENT: input.event },
  });

  if (child.error) return { decision: 'deny', reason: child.error.message };
  if (child.status && child.status !== 0) {
    const reason = (child.stderr || child.stdout || `hook exited ${child.status}`).trim();
    return { decision: 'deny', reason: reason.slice(0, 1000) };
  }

  return parseHookResult(child.stdout || '');
}

export function formatHookBlock(input: ToolHookInput): string {
  return JSON.stringify(
    {
      event: input.event,
      toolName: input.toolName,
      status: input.status,
      errorType: input.errorType,
      summary: input.summary,
    },
    null,
    2
  );
}
