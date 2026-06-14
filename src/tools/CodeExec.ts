import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from './Registry.js';

export const codeExecTool: Tool = {
  name: 'code_exec',
  description: 'Execute code in Python, Node.js, or shell. Runs code in a temp file and returns output. Use for quick calculations, data processing, or testing snippets.',
  parameters: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Language to run: python, node, bash (default: python)',
      },
      code: {
        type: 'string',
        description: 'Code to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default: 30)',
      },
    },
    required: ['code'],
  },
  async execute(args) {
    const language = (args.language as string) || 'python';
    const code = args.code as string;
    const timeout = ((args.timeout as number) || 30) * 1000;

    const tmpDir = os.tmpdir();
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let cmd: string;
    let file: string;

    switch (language) {
      case 'python':
      case 'py':
        file = path.join(tmpDir, `aurix_${stamp}.py`);
        fs.writeFileSync(file, code);
        cmd = `python3 ${file}`;
        break;
      case 'node':
      case 'js':
      case 'javascript':
        file = path.join(tmpDir, `aurix_${stamp}.js`);
        fs.writeFileSync(file, code);
        cmd = `node ${file}`;
        break;
      case 'bash':
      case 'sh':
        file = path.join(tmpDir, `aurix_${stamp}.sh`);
        fs.writeFileSync(file, code);
        cmd = `bash ${file}`;
        break;
      default:
        return `Unsupported language: ${language}. Use python, node, or bash.`;
    }

    return new Promise<string>(resolve => {
      exec(cmd, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        try { fs.unlinkSync(file); } catch {}

        const parts: string[] = [];
        if (stdout) parts.push(stdout.trim());
        if (stderr) parts.push(`[stderr] ${stderr.trim()}`);
        if (err && !stdout && !stderr) parts.push(`Error: ${err.message}`);
        if (parts.length === 0) parts.push('(no output)');

        resolve(parts.join('\n'));
      });
    });
  },
};
