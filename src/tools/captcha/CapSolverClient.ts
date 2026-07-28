import { loadConfig, type AurixConfig } from '../../agent/Config.js';
import { validateCapSolverTask, type CapSolverTask } from './CapSolverTypes.js';

const API_BASE = 'https://api.capsolver.com';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_POLLS = 120;
const MAX_TASK_AGE_MS = 5 * 60 * 1000;

export type CapSolverResponse = {
  errorId?: number;
  errorCode?: string;
  errorDescription?: string;
  status?: 'idle' | 'processing' | 'ready';
  taskId?: string;
  solution?: Record<string, unknown>;
  balance?: number;
  packages?: unknown[];
};

export type CapSolverResult = {
  ok: boolean;
  taskId?: string;
  status?: string;
  solution?: Record<string, unknown>;
  balance?: number;
  elapsedMs?: number;
  errorCode?: string;
  error?: string;
};

export function capSolverConfigured(config: AurixConfig = loadConfig()): boolean {
  return config.IsSolverApiEnabled === true && Boolean(config.capSolverApiKey?.trim());
}

export class CapSolverClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(apiKey: string, fetcher: typeof fetch = fetch) {
    this.apiKey = apiKey.trim();
    this.fetcher = fetcher;
  }

  private async request(path: string, body: Record<string, unknown>, timeoutMs = 30_000): Promise<CapSolverResponse> {
    if (!this.apiKey) throw new Error('CapSolver API key is not configured');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetcher(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: this.apiKey, ...body }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new Error('CapSolver response exceeded size limit');
      let parsed: CapSolverResponse;
      try {
        parsed = JSON.parse(text) as CapSolverResponse;
      } catch {
        throw new Error(`CapSolver returned invalid JSON (HTTP ${response.status})`);
      }
      if (!response.ok) throw new Error(`CapSolver HTTP ${response.status}`);
      if (parsed.errorId && parsed.errorId !== 0) {
        const error = new Error(parsed.errorDescription || parsed.errorCode || 'CapSolver request failed');
        Object.assign(error, { code: parsed.errorCode });
        throw error;
      }
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getBalance(timeoutMs = 30_000): Promise<CapSolverResult> {
    try {
      const response = await this.request('/getBalance', {}, timeoutMs);
      if (typeof response.balance !== 'number') throw new Error('CapSolver balance response is missing balance');
      return { ok: true, balance: response.balance };
    } catch (error: any) {
      return { ok: false, errorCode: error?.code, error: String(error?.message || error) };
    }
  }

  async createTask(task: CapSolverTask, timeoutMs = 30_000): Promise<CapSolverResponse> {
    return this.request('/createTask', { task: validateCapSolverTask(task) }, timeoutMs);
  }

  async getTaskResult(taskId: string): Promise<CapSolverResult> {
    if (!taskId.trim()) return { ok: false, error: 'taskId is required' };
    try {
      const response = await this.request('/getTaskResult', { taskId });
      return {
        ok: response.status === 'ready',
        taskId,
        status: response.status,
        solution: response.solution,
      };
    } catch (error: any) {
      return { ok: false, taskId, errorCode: error?.code, error: String(error?.message || error) };
    }
  }

  async solveTask(taskInput: Record<string, unknown>, options: { timeoutMs?: number; pollIntervalMs?: number } = {}): Promise<CapSolverResult> {
    const startedAt = Date.now();
    try {
      const task = validateCapSolverTask(taskInput);
      const timeoutMs = Math.min(options.timeoutMs ?? MAX_TASK_AGE_MS, MAX_TASK_AGE_MS);
      const remaining = () => Math.max(1, timeoutMs - (Date.now() - startedAt));
      const balance = await this.getBalance(remaining());
      if (!balance.ok) return { ...balance, elapsedMs: Date.now() - startedAt };
      if ((balance.balance ?? 0) <= 0) return { ok: false, balance: balance.balance, error: 'CapSolver balance is zero', elapsedMs: Date.now() - startedAt };
      if (Date.now() - startedAt >= timeoutMs) return { ok: false, balance: balance.balance, error: 'CapSolver task timed out', elapsedMs: Date.now() - startedAt };
      const created = await this.createTask(task, remaining());
      if (created.status === 'ready' && created.solution) {
        return { ok: true, taskId: created.taskId, status: 'ready', balance: balance.balance, solution: created.solution, elapsedMs: Date.now() - startedAt };
      }
      if (!created.taskId) throw new Error('CapSolver did not return a taskId');
      const intervalMs = Math.max(500, options.pollIntervalMs ?? 1500);
      for (let poll = 0; poll < MAX_POLLS; poll++) {
        const remainingMs = timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remainingMs)));
        if (Date.now() - startedAt >= timeoutMs) break;
        const requestTimeoutMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
        const response = await this.request('/getTaskResult', { taskId: created.taskId }, requestTimeoutMs);
        if (response.status === 'ready') {
          if (!response.solution || Object.keys(response.solution).length === 0) {
            throw new Error('CapSolver returned ready without a solution');
          }
          return { ok: true, taskId: created.taskId, status: 'ready', balance: balance.balance, solution: response.solution, elapsedMs: Date.now() - startedAt };
        }
      }
      return { ok: false, taskId: created.taskId, status: 'processing', balance: balance.balance, error: 'CapSolver task timed out', elapsedMs: Date.now() - startedAt };
    } catch (error: any) {
      return { ok: false, errorCode: error?.code, error: String(error?.message || error), elapsedMs: Date.now() - startedAt };
    }
  }
}

export function createConfiguredCapSolverClient(config: AurixConfig = loadConfig()): CapSolverClient | undefined {
  if (!capSolverConfigured(config)) return undefined;
  return new CapSolverClient(config.capSolverApiKey || '');
}
