import { exec, spawn } from 'child_process';
import type { Tool, ToolExecutionContext } from './Registry.js';
import {
  detectBlockedDeleteCommand,
  formatBlockedDeleteCommand,
} from '../agent/DestructiveActionPolicy.js';

function shellCommand(command: string): { cmd: string; args: string[]; shell?: true } {
  if (process.platform === 'win32') return { cmd: command, args: [], shell: true };
  return { cmd: '/bin/bash', args: ['-lc', command] };
}

function emitLines(
  context: ToolExecutionContext | undefined,
  stream: 'stdout' | 'stderr',
  chunk: Buffer,
  buffer: { value: string }
) {
  if (!context?.onEvent) return;
  buffer.value += chunk.toString();
  const lines = buffer.value.split(/\r?\n/);
  buffer.value = lines.pop() || '';
  for (const line of lines) {
    if (line.trim()) context.onEvent({ type: 'chunk', stream, data: line });
  }
}

function flushLine(
  context: ToolExecutionContext | undefined,
  stream: 'stdout' | 'stderr',
  buffer: { value: string }
) {
  if (!context?.onEvent) return;
  const line = buffer.value.trim();
  if (line) context.onEvent({ type: 'chunk', stream, data: line });
  buffer.value = '';
}

async function runCommand(
  command: string,
  timeout: number,
  context?: ToolExecutionContext
): Promise<string> {
  const timeoutOption = timeout > 0 ? timeout : undefined;
  if (!context?.onEvent) {
    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? true : '/bin/bash';
      exec(
        command,
        { timeout: timeoutOption, maxBuffer: 1024 * 1024 * 5, shell: shell as any },
        (err: any, stdout: any, stderr: any) => {
          const output = [];
          if (stdout) output.push(stdout.trim());
          if (stderr) output.push(`[stderr] ${stderr.trim()}`);
          if (err && err.killed) output.push('[timeout] Command killed after timeout');
          else if (err) output.push(`[exit ${err.code}]`);
          resolve(output.join('\n') || '(no output)');
        }
      );
    });
  }

  return new Promise((resolve) => {
    const { cmd, args, shell } = shellCommand(command);
    const child = spawn(cmd, args, { shell, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutLine = { value: '' };
    const stderrLine = { value: '' };
    let timedOut = false;

    const timer = timeout > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          }, 1000).unref?.();
        }, timeout)
      : undefined;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      emitLines(context, 'stdout', chunk, stdoutLine);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      emitLines(context, 'stderr', chunk, stderrLine);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      context.onEvent?.({ type: 'chunk', stream: 'stderr', data: `spawn error: ${err.message}` });
      resolve(`Error executing command: ${err.message}`);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      flushLine(context, 'stdout', stdoutLine);
      flushLine(context, 'stderr', stderrLine);
      const stdout = Buffer.concat(stdoutChunks).toString().trim();
      const stderr = Buffer.concat(stderrChunks).toString().trim();
      const output = [];
      if (stdout) output.push(stdout);
      if (stderr) output.push(`[stderr] ${stderr}`);
      if (timedOut) output.push('[timeout] Command killed after timeout');
      else if (code && code !== 0) output.push(`[exit ${code}]`);
      resolve(output.join('\n') || '(no output)');
    });
  });
}

export const terminalTool: Tool = {
  name: 'terminal',
  description: `Execute a shell command and return its output. Use for system commands, running services, installing packages, git operations, and terminal-specific tasks. For file operations prefer dedicated tools: read_file (not cat), file_edit (not sed/awk), write_file (not echo), search_files (not grep/find).`,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds. 0 or omitted means no timeout; set this for fragile or long-lived commands.' },
    },
    required: ['command'],
  },
  async execute(args) {
    const command = args.command as string;
    const blocked = detectBlockedDeleteCommand(command);
    if (blocked) return formatBlockedDeleteCommand(blocked);
    const timeout = typeof args.timeout === 'number' ? args.timeout : 0;
    return runCommand(command, timeout);
  },
  async executeWithEvents(args, context) {
    const command = args.command as string;
    const blocked = detectBlockedDeleteCommand(command);
    if (blocked) return formatBlockedDeleteCommand(blocked);
    const timeout = typeof args.timeout === 'number' ? args.timeout : 0;
    return runCommand(command, timeout, context);
  },
};
