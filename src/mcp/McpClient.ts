import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
}

export type McpClientOptions =
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; cwd?: string; timeout?: number; connectTimeout?: number }
  | { type: 'http'; url: string; headers?: Record<string, string>; timeout?: number; connectTimeout?: number; token?: string; tokenProvider?: () => Promise<string | undefined>; onUnauthorized?: () => Promise<string | undefined> };

export class McpAuthenticationRequiredError extends Error {
  constructor(public readonly authenticate?: string) {
    super('Authentication required');
    this.name = 'McpAuthenticationRequiredError';
  }
}

export class McpClient extends EventEmitter {
  private name: string;
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';
  private sessionId?: string;
  private _capabilities: McpServerCapabilities = {};
  private _tools: McpToolSchema[] = [];
  private _initialized = false;
  private stopped = true;
  private readonly options: McpClientOptions;

  constructor(name: string, options: McpClientOptions);
  constructor(name: string, command: string, args?: string[], env?: Record<string, string>);
  constructor(name: string, optionsOrCommand: McpClientOptions | string, args: string[] = [], env: Record<string, string> = {}) {
    super();
    this.name = name;
    this.options = typeof optionsOrCommand === 'string'
      ? { type: 'stdio', command: optionsOrCommand, args, env }
      : optionsOrCommand;
  }

  get capabilities(): McpServerCapabilities { return this._capabilities; }
  get tools(): McpToolSchema[] { return this._tools; }
  get initialized(): boolean { return this._initialized; }
  get running(): boolean { return !this.stopped && (this.options.type === 'http' || (this.proc !== null && this.proc.exitCode === null)); }
  get transportType(): 'stdio' | 'http' { return this.options.type; }

  async start(): Promise<void> {
    if (this.running) return;
    this.stopped = false;
    if (this.options.type === 'stdio') this.startStdio();
    try {
      await this.withTimeout(this.initialize(), this.options.connectTimeout || 30_000, 'MCP connection');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private startStdio(): void {
    const options = this.options as Extract<McpClientOptions, { type: 'stdio' }>;
    const proc = spawn(options.command, options.args || [], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    proc.stdout?.on('data', (chunk: Buffer) => { this.buffer += chunk.toString(); this.processBuffer(); });
    proc.stderr?.on('data', (chunk: Buffer) => this.emit('stderr', chunk.toString()));
    proc.on('error', (error) => { this.rejectAll(error); this.emit('clientError', error); });
    proc.on('close', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this._initialized = false;
      this.stopped = true;
      this.rejectAll(new Error(`MCP server "${this.name}" exited with code ${code}`));
      this.emit('close', code);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this._initialized = false;
    this.sessionId = undefined;
    this.buffer = '';
    this.rejectAll(new Error(`MCP server "${this.name}" stopped`));
    if (!this.proc) return;
    const proc = this.proc;
    this.proc = null;
    await new Promise<void>((resolve) => {
      let settled = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        if (settled) return;
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        resolve();
      };
      proc.once('close', done);
      proc.kill('SIGTERM');
      forceTimer = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
        setTimeout(done, 250).unref?.();
      }, 1000);
    });
  }

  async listTools(): Promise<McpToolSchema[]> {
    const result = await this.send('tools/list', {}) as { tools?: McpToolSchema[] };
    this._tools = result?.tools || [];
    return this._tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.send('tools/call', { name, arguments: args });
  }

  async listResources(): Promise<McpResource[]> {
    const result = await this.send('resources/list', {}) as { resources?: McpResource[] };
    return result?.resources || [];
  }

  async readResource(uri: string): Promise<unknown> { return this.send('resources/read', { uri }); }

  private async initialize(): Promise<void> {
    const result = await this.send('initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'aurix-ai', version: '3.1.1' },
    }) as { capabilities?: McpServerCapabilities };
    this._capabilities = result?.capabilities || {};
    await this.send('notifications/initialized', undefined, true);
    this._initialized = true;
    if (this._capabilities.tools) await this.listTools();
  }

  private send(method: string, params: unknown, notification = false): Promise<unknown> {
    return this.options.type === 'http'
      ? this.sendHttp(method, params, notification)
      : this.sendStdio(method, params, notification);
  }

  private sendStdio(method: string, params: unknown, notification: boolean): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin?.writable) return reject(new Error(`MCP server "${this.name}" is not running`));
      const id = this.nextId++;
      const message = notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
      if (!notification) {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP request "${method}" timed out`)); }, this.options.timeout || 30_000);
        this.pending.set(id, { resolve, reject, timer });
      }
      this.proc.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          const pending = this.pending.get(id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(id);
          }
          reject(error);
        } else if (notification) resolve(undefined);
      });
    });
  }

  private async sendHttp(method: string, params: unknown, notification: boolean, retried = false): Promise<unknown> {
    const options = this.options as Extract<McpClientOptions, { type: 'http' }>;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 30_000);
    const id = this.nextId++;
    const message = notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2024-11-05',
      ...options.headers,
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    const token = options.tokenProvider ? await options.tokenProvider() : options.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await fetch(options.url, { method: 'POST', headers, body: JSON.stringify(message), signal: controller.signal });
      if (response.status === 401) {
        if (!retried && options.onUnauthorized) {
          const refreshed = await options.onUnauthorized();
          if (refreshed) return this.sendHttp(method, params, notification, true);
        }
        throw new McpAuthenticationRequiredError(response.headers.get('www-authenticate') || undefined);
      }
      if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
      const session = response.headers.get('mcp-session-id');
      if (session) this.sessionId = session;
      if (notification || response.status === 202) return undefined;
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('text/event-stream')
        ? await this.readSseResponse(response, id, controller.signal)
        : JSON.parse(await response.text());
      if (payload.error) throw new Error(`MCP error ${payload.error.code}: ${payload.error.message}`);
      return payload.result;
    } finally {
      clearTimeout(timer);
    }
  }

  private async readSseResponse(response: Response, id: number, signal: AbortSignal): Promise<JsonRpcResponse> {
    if (!response.body) throw new Error('MCP SSE response has no body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const processBlocks = (): JsonRpcResponse | undefined => {
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!data) continue;
        const parsed = JSON.parse(data) as JsonRpcResponse;
        if (parsed.id === id) return parsed;
        if (parsed.method) this.emit('notification', parsed);
      }
      return undefined;
    };
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: !done });
        const result = processBlocks();
        if (result) return result;
        if (done) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    throw new Error('MCP SSE response did not contain a matching JSON-RPC result');
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as JsonRpcResponse;
        if (message.id !== undefined && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id)!;
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
          else pending.resolve(message.result);
        } else if (message.method) this.emit('notification', message);
      } catch {}
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  private withTimeout<T>(promise: Promise<T>, timeout: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
      promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
  }
}
