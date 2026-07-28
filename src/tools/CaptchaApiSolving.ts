import type { Tool } from './Registry.js';
import { loadConfig } from '../agent/Config.js';
import { CapSolverClient, capSolverConfigured } from './captcha/CapSolverClient.js';
import { CAPSOLVER_TASK_TYPES, redactCapSolverValue } from './captcha/CapSolverTypes.js';

export const captchaApiSolvingTool: Tool = {
  name: 'captcha_api_solving',
  displayName: 'Captcha API Solving',
  description: 'Explicitly enabled paid CapSolver fallback. Use only after native CAPTCHA solving is exhausted. Checks balance before every new solve task.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get_balance', 'solve', 'get_task_result', 'supported_tasks'] },
      taskType: { type: 'string', enum: [...CAPSOLVER_TASK_TYPES] },
      task: { type: 'object', description: 'Structured task fields documented by CapSolver. The type is taken from taskType.' },
      taskId: { type: 'string' },
      timeoutMs: { type: 'number' },
    },
    required: ['action'],
  },
  async execute(args) {
    const config = loadConfig();
    if (!capSolverConfigured(config)) return JSON.stringify({ ok: false, error: 'CapSolver fallback is disabled or not configured' });
    const client = new CapSolverClient(config.capSolverApiKey || '');
    const action = String(args.action || '');
    if (action === 'supported_tasks') return JSON.stringify({ ok: true, tasks: CAPSOLVER_TASK_TYPES });
    if (action === 'get_balance') return JSON.stringify(await client.getBalance());
    if (action === 'get_task_result') {
      return JSON.stringify(redactCapSolverValue(await client.getTaskResult(String(args.taskId || ''))));
    }
    if (action === 'solve') {
      const task = args.task && typeof args.task === 'object' ? { ...(args.task as Record<string, unknown>) } : {};
      task.type = args.taskType;
      const result = await client.solveTask(task, { timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined });
      return JSON.stringify(redactCapSolverValue(result));
    }
    return JSON.stringify({ ok: false, error: `Unknown action: ${action}` });
  },
};
