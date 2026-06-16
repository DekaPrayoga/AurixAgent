import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
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
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
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

export class McpClient extends EventEmitter {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';
  private _capabilities: McpServerCapabilities = {};
  private _tools: McpToolSchema[] = [];
  private _initialized = false;

  constructor(
    private name: string,
    private command: string,
    private args: string[] = [],
    private env: Record<string, string> = {},
  ) {
    super();
  }

  get capabilities(): McpServerCapabilities { return this._capabilities; }
  get tools(): McpToolSchema[] { return this._tools; }
  get initialized(): boolean { return this._initialized; }
  get running(): boolean { return this.proc !== null && this.proc.exitCode === null; }

  async start(): Promise<void> {
    if (this.running) return;

    this.proc = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString());
    });

    this.proc.on('error', (err) => {
      this.rejectAll(err);
      this.emit('error', err);
    });

    this.proc.on('close', (code) => {
      this.rejectAll(new Error(`MCP server "${this.name}" exited with code ${code}`));
      this.proc = null;
      this._initialized = false;
      this.emit('close', code);
    });

    await this.initialize();
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    const proc = this.proc;
    return new Promise<void>((resolve) => {
      proc.once('close', () => resolve());
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill('SIGKILL');
        resolve();
      }, 5000);
    });
  }

  async listTools(): Promise<McpToolSchema[]> {
    const result = await this.send('tools/list', {}) as { tools: McpToolSchema[] };
    this._tools = result.tools || [];
    return this._tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.send('tools/call', { name, arguments: args });
  }

  async listResources(): Promise<McpResource[]> {
    const result = await this.send('resources/list', {}) as { resources: McpResource[] };
    return result.resources || [];
  }

  async readResource(uri: string): Promise<unknown> {
    return this.send('resources/read', { uri });
  }

  private async initialize(): Promise<void> {
    const result = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'aurix-ai', version: '2.9.5' },
    }) as { capabilities: McpServerCapabilities };

    this._capabilities = result.capabilities || {};

    await this.send('notifications/initialized', undefined, true);
    this._initialized = true;

    if (this._capabilities.tools) {
      await this.listTools();
    }
  }

  private send(method: string, params: unknown, isNotification = false): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin?.writable) {
        reject(new Error(`MCP server "${this.name}" is not running`));
        return;
      }

      const id = this.nextId++;
      const msg: JsonRpcRequest | JsonRpcNotification = isNotification
        ? { jsonrpc: '2.0', method, params }
        : { jsonrpc: '2.0', id, method, params };

      const payload = JSON.stringify(msg) + '\n';

      if (!isNotification) {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`MCP request "${method}" timed out after 30s`));
        }, 30_000);
        this.pending.set(id, { resolve, reject, timer });
      }

      this.proc!.stdin!.write(payload, (err) => {
        if (err) {
          if (!isNotification) {
            const p = this.pending.get(id);
            if (p) { clearTimeout(p.timer); this.pending.delete(id); }
          }
          reject(err);
        } else if (isNotification) {
          resolve(undefined);
        }
      });
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) {
            p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            p.resolve(msg.result);
          }
        } else if ('method' in msg) {
          this.emit('notification', msg);
        }
      } catch {}
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
}
