import { exec } from 'child_process';
import type { Tool } from './Registry.js';

export const browserTool: Tool = {
  name: 'browser',
  description: 'Control a browser via ATR CLI. Actions: navigate, click, fill, screenshot, snapshot, text, url, title, scroll, back, forward, press-key.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Browser action: navigate, click, fill, screenshot, snapshot, text, url, title, scroll, back, forward, press-key, status, start, stop',
      },
      target: { type: 'string', description: 'Target element (for click/fill/hover) - text, selector, or UID' },
      value: { type: 'string', description: 'Value for fill action or URL for navigate' },
      selector: { type: 'string', description: 'CSS selector for text/screenshot actions' },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = args.action as string;
    const target = args.target as string;
    const value = args.value as string;
    const selector = args.selector as string;

    let cmd = `atr browser ${action}`;

    switch (action) {
      case 'navigate':
        cmd += ` "${value || target}"`;
        break;
      case 'click':
        cmd += ` "${target}"`;
        break;
      case 'fill':
        cmd += ` "${target}" "${value}"`;
        break;
      case 'screenshot':
        cmd += ' --file';
        if (selector) cmd += ` -s "${selector}"`;
        break;
      case 'snapshot':
      case 'text':
      case 'url':
      case 'title':
      case 'html':
        if (selector) cmd += ` "${selector}"`;
        break;
      case 'scroll':
        if (selector) cmd += ` --selector "${selector}"`;
        cmd += ' --to-bottom';
        break;
      case 'press-key':
        cmd += ` "${target}"`;
        break;
      case 'back':
      case 'forward':
      case 'reload':
      case 'status':
      case 'start':
      case 'stop':
        break;
    }

    return new Promise((resolve) => {
      exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (stdout.trim()) resolve(stdout.trim());
        else if (stderr.trim()) resolve(`[error] ${stderr.trim()}`);
        else if (err) resolve(`[error] ${err.message}`);
        else resolve('(no output)');
      });
    });
  },
};
