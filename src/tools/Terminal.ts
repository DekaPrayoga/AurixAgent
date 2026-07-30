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

const SSH_INVOCATION_RE = /(^\s*|[;&|(]\s*)ssh(?=\s)/g;
const APT_INSTALL_RE = /(^\s*|[;&|(]\s*)(sudo\s+)?(apt|apt-get)\s+install\b/g;

// stdin is always closed for spawned commands (stdio: ['ignore', ...]), so
// interactive prompts can never be answered. Make common install/remote commands
// non-interactive or fail-fast instead of silently hanging in gateways.
function hardenNonInteractiveCommand(command: string): string {
  let prepared = command;

  if (!/sshpass/i.test(prepared) && /(^\s*|[;&|(]\s*)ssh(?=\s)/.test(prepared)) {
    const lower = prepared.toLowerCase();
    const opts: string[] = [];
    if (!lower.includes('batchmode')) opts.push('-o BatchMode=yes', '-o ConnectTimeout=15');
    if (!lower.includes('stricthostkeychecking')) opts.push('-o StrictHostKeyChecking=accept-new');
    if (opts.length > 0) {
      prepared = prepared.replace(SSH_INVOCATION_RE, (match) => `${match} ${opts.join(' ')} `);
    }
  }

  if (/(^\s*|[;&|(]\s*)(sudo\s+)?(apt|apt-get)\s+install\b/.test(prepared)) {
    prepared = prepared.replace(APT_INSTALL_RE, (match, prefix, sudoPart = '', aptCmd) => {
      if (/DEBIAN_FRONTEND=noninteractive\s+/.test(match)) return match;
      const sudo = sudoPart ? 'sudo -n ' : '';
      return `${prefix}DEBIAN_FRONTEND=noninteractive ${sudo}${aptCmd} install -y `;
    });
  }

  prepared = prepared.replace(/(^\s*|[;&|(]\s*)sudo\s+(?!-n\b)/g, '$1sudo -n ');

  return prepared;
}

function emitLines(
  context: ToolExecutionContext | undefined,
  stream: 'stdout' | 'stderr',
  chunk: Buffer,
  buffer: { value: string }
) {
  if (!context?.onEvent) return;
  buffer.value += chunk.toString();
  const maxPartialLineChars = 64 * 1024;
  const lines = buffer.value.split(/\r\n|\n|\r/);
  buffer.value = lines.pop() || '';
  for (const line of lines) {
    if (line.trim()) context.onEvent({ type: 'chunk', stream, data: line });
  }
  while (buffer.value.length > maxPartialLineChars) {
    const segment = buffer.value.slice(0, maxPartialLineChars);
    buffer.value = buffer.value.slice(maxPartialLineChars);
    context.onEvent({ type: 'chunk', stream, data: `${segment}\n[continued]` });
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
  const preparedCommand = hardenNonInteractiveCommand(command);
  const timeoutOption = timeout > 0 ? timeout : undefined;
  if (!context?.onEvent) {
    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? true : '/bin/bash';
      exec(
        preparedCommand,
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
    const { cmd, args, shell } = shellCommand(preparedCommand);
    const child = spawn(cmd, args, {
      shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const maxCapturedBytes = 5 * 1024 * 1024;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputTruncated = false;
    const stdoutLine = { value: '' };
    const stderrLine = { value: '' };
    let timedOut = false;
    let aborted = false;
    const terminate = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {}
    };
    const onAbort = () => {
      aborted = true;
      terminate('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) terminate('SIGKILL');
      }, 1000).unref?.();
    };
    if (context.signal?.aborted) onAbort();
    else context.signal?.addEventListener('abort', onAbort, { once: true });

    const timer =
      timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            terminate('SIGTERM');
            setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) terminate('SIGKILL');
            }, 1000).unref?.();
          }, timeout)
        : undefined;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBytes < maxCapturedBytes) {
        const remaining = maxCapturedBytes - stdoutBytes;
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes += Math.min(chunk.length, remaining);
        if (chunk.length > remaining) outputTruncated = true;
      } else outputTruncated = true;
      emitLines(context, 'stdout', chunk, stdoutLine);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes < maxCapturedBytes) {
        const remaining = maxCapturedBytes - stderrBytes;
        stderrChunks.push(chunk.subarray(0, remaining));
        stderrBytes += Math.min(chunk.length, remaining);
        if (chunk.length > remaining) outputTruncated = true;
      } else outputTruncated = true;
      emitLines(context, 'stderr', chunk, stderrLine);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      context.signal?.removeEventListener('abort', onAbort);
      context.onEvent?.({ type: 'chunk', stream: 'stderr', data: `spawn error: ${err.message}` });
      resolve(`Error executing command: ${err.message}`);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      context.signal?.removeEventListener('abort', onAbort);
      flushLine(context, 'stdout', stdoutLine);
      flushLine(context, 'stderr', stderrLine);
      const stdout = Buffer.concat(stdoutChunks).toString().trim();
      const stderr = Buffer.concat(stderrChunks).toString().trim();
      const output = [];
      if (stdout) output.push(stdout);
      if (stderr) output.push(`[stderr] ${stderr}`);
      if (outputTruncated) output.push('[output truncated after 5MB per stream]');
      if (aborted) output.push('[cancelled] Command terminated');
      else if (timedOut) output.push('[timeout] Command killed after timeout');
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
      timeout: {
        type: 'number',
        description:
          'Timeout in milliseconds. 0 or omitted means no timeout; set this for fragile or long-lived commands.',
      },
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
