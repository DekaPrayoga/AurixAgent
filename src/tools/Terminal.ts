import { execSync, exec } from 'child_process';
import type { Tool } from './Registry.js';

export const terminalTool: Tool = {
  name: 'terminal',
  description: 'Execute a shell command and return its output. Use for running commands, checking system state, installing packages, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
    },
    required: ['command'],
  },
  async execute(args) {
    const command = args.command as string;
    const timeout = (args.timeout as number) || 30000;

    return new Promise((resolve) => {
      exec(command, { timeout, maxBuffer: 1024 * 1024 * 5, shell: '/bin/bash' }, (err, stdout, stderr) => {
        const output = [];
        if (stdout) output.push(stdout.trim());
        if (stderr) output.push(`[stderr] ${stderr.trim()}`);
        if (err && err.killed) output.push('[timeout] Command killed after timeout');
        else if (err) output.push(`[exit ${err.code}]`);
        resolve(output.join('\n') || '(no output)');
      });
    });
  },
};
