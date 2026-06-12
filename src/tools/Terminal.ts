import { execSync, exec } from 'child_process';
import type { Tool } from './Registry.js';

export const terminalTool: Tool = {
  name: 'terminal',
  description: `Execute a shell command and return its output. Use for system commands, running services, installing packages, git operations, and terminal-specific tasks. For file operations prefer dedicated tools: read_file (not cat), file_edit (not sed/awk), write_file (not echo), search_files (not grep/find).`,
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
