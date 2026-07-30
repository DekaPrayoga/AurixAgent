import fs from 'fs';
import path from 'path';
import os from 'os';
import { McpAuthenticationRequiredError, McpClient, type McpClientOptions } from './McpClient.js';
import { accessToken, beginOAuthLogin, completeOAuthCallback, removeOAuth, refreshToken, type McpOAuthConfig } from './McpOAuth.js';

export const getMcpConfigFile = (): string => path.join(process.env.HOME || os.homedir(), '.aurix', 'mcp.json');
const getLegacyConfigFile = (): string => path.join(process.env.HOME || os.homedir(), '.aurix', 'mcp', 'servers.json');
export const MCP_CONFIG_FILE = getMcpConfigFile();

interface McpCommonConfig {
  name: string;
  enabled: boolean;
  description?: string;
  timeout?: number;
  connectTimeout?: number;
}

export type McpServerConfig = McpCommonConfig & (
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { type: 'http'; url: string; headers?: Record<string, string>; auth?: 'none' | 'oauth' | 'bearer'; tokenEnv?: string; oauth?: McpOAuthConfig }
);

export interface McpConfig { servers: McpServerConfig[]; errors?: string[] }
export type McpServerState = 'disabled' | 'connecting' | 'authenticating' | 'connected' | 'authentication-required' | 'failed' | 'stopped';
export interface McpServerStatus {
  name: string;
  enabled: boolean;
  running: boolean;
  state: McpServerState;
  transport: 'stdio' | 'http';
  toolCount: number;
  description?: string;
  error?: string;
}

function ensureDir(): void { fs.mkdirSync(path.dirname(getMcpConfigFile()), { recursive: true }); }

function normalizeServer(name: string, raw: any): McpServerConfig {
  if (!raw || typeof raw !== 'object') throw new Error(`${name}: server entry must be an object`);
  const common = {
    name,
    enabled: raw.enabled !== false,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    timeout: typeof raw.timeout === 'number' ? (raw.timeout < 1000 ? raw.timeout * 1000 : raw.timeout) : undefined,
    connectTimeout: typeof raw.connectTimeout === 'number' ? raw.connectTimeout : typeof raw.connect_timeout === 'number' ? raw.connect_timeout * 1000 : undefined,
  };
  if (raw.type === 'http' || raw.url) {
    if (typeof raw.url !== 'string' || !/^https?:\/\//.test(raw.url)) throw new Error(`${name}: HTTP server requires a valid url`);
    return { ...common, type: 'http', url: raw.url, headers: raw.headers, auth: raw.auth || 'none', tokenEnv: raw.tokenEnv, oauth: raw.oauth };
  }
  if (typeof raw.command !== 'string' || !raw.command.trim()) throw new Error(`${name}: stdio server requires command`);
  return { ...common, type: 'stdio', command: raw.command, args: Array.isArray(raw.args) ? raw.args.map(String) : [], env: raw.env, cwd: raw.cwd };
}

function parseConfig(raw: any): McpConfig {
  const errors: string[] = [];
  const source = raw?.mcpServers && typeof raw.mcpServers === 'object'
    ? raw.mcpServers
    : Array.isArray(raw?.servers)
      ? Object.fromEntries(raw.servers.map((server: any) => [server.name, server]))
      : raw;
  const servers: McpServerConfig[] = [];
  if (!source || typeof source !== 'object' || Array.isArray(source)) return { servers, errors: ['MCP config must be an object'] };
  for (const [name, entry] of Object.entries(source)) {
    try { servers.push(normalizeServer(name, entry)); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  return { servers, errors };
}

export function loadMcpConfig(): McpConfig {
  ensureDir();
  try {
    const configFile = getMcpConfigFile();
    const legacyFile = getLegacyConfigFile();
    if (fs.existsSync(configFile)) return parseConfig(JSON.parse(fs.readFileSync(configFile, 'utf8')));
    if (fs.existsSync(legacyFile)) {
      const migrated = parseConfig(JSON.parse(fs.readFileSync(legacyFile, 'utf8')));
      if (!migrated.errors?.length) saveMcpConfig(migrated);
      return migrated;
    }
  } catch (error) {
    return { servers: [], errors: [error instanceof Error ? error.message : String(error)] };
  }
  return { servers: [] };
}

export function saveMcpConfig(config: McpConfig): void {
  ensureDir();
  const entries = Object.fromEntries(config.servers.map((server) => {
    const { name, ...value } = server;
    return [name, value];
  }));
  const configFile = getMcpConfigFile();
  const temp = `${configFile}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify({ mcpServers: entries }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, configFile);
  fs.chmodSync(configFile, 0o600);
}

export function addMcpServer(server: McpServerConfig): void {
  const config = loadMcpConfig();
  const index = config.servers.findIndex((item) => item.name === server.name);
  if (index >= 0) config.servers[index] = server;
  else config.servers.push(server);
  saveMcpConfig(config);
}

export function removeMcpServer(name: string): void {
  const config = loadMcpConfig();
  config.servers = config.servers.filter((server) => server.name !== name);
  saveMcpConfig(config);
}

export function toggleMcpServer(name: string): boolean | null {
  const config = loadMcpConfig();
  const server = config.servers.find((item) => item.name === name);
  if (!server) return null;
  server.enabled = !server.enabled;
  saveMcpConfig(config);
  return server.enabled;
}

export type McpServerPreset =
  | Omit<Extract<McpServerConfig, { type: 'stdio' }>, 'name' | 'enabled'>
  | Omit<Extract<McpServerConfig, { type: 'http' }>, 'name' | 'enabled'>;

export const PRESET_SERVERS: Record<string, McpServerPreset> = {
  ares: { type: 'http', url: 'https://aresmcp.com/mcp', auth: 'oauth', timeout: 300_000, connectTimeout: 60_000, description: 'Ares security and OSINT MCP' },
  github: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '<your-token>' }, description: 'GitHub repos, PRs, issues, actions' },
  filesystem: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', os.homedir()], description: 'Filesystem read/write/search' },
  postgres: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { DATABASE_URL: 'postgresql://localhost:5432/mydb' }, description: 'PostgreSQL database queries' },
  sqlite: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sqlite'], env: { SQLITE_DB_PATH: './data.db' }, description: 'SQLite database queries' },
};

export class McpServerManager {
  private clients = new Map<string, McpClient>();
  private errors = new Map<string, string>();
  private states = new Map<string, McpServerState>();

  async startAll(): Promise<void> {
    const config = loadMcpConfig();
    await Promise.allSettled(config.servers.filter((server) => server.enabled).map((server) => this.startServer(server)));
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.clients.values()].map((client) => client.stop()));
    this.clients.clear();
    for (const server of loadMcpConfig().servers) this.states.set(server.name, server.enabled ? 'stopped' : 'disabled');
  }

  async startServer(config: McpServerConfig): Promise<boolean> {
    if (!config.enabled) { this.states.set(config.name, 'disabled'); return false; }
    if (this.clients.get(config.name)?.running) return true;
    this.states.set(config.name, 'connecting');
    const options: McpClientOptions = config.type === 'stdio'
      ? { type: 'stdio', command: config.command, args: config.args, env: config.env, cwd: config.cwd, timeout: config.timeout, connectTimeout: config.connectTimeout }
      : {
          type: 'http',
          url: config.url,
          headers: config.headers,
          timeout: config.timeout,
          connectTimeout: config.connectTimeout,
          token: config.tokenEnv ? process.env[config.tokenEnv] : undefined,
          tokenProvider: config.auth === 'oauth' ? () => accessToken(config.name, config.url, config.oauth) : undefined,
          onUnauthorized: config.auth === 'oauth' ? () => refreshToken(config.name, config.url, config.oauth) : undefined,
        };
    const client = new McpClient(config.name, options);
    try {
      await client.start();
      this.clients.set(config.name, client);
      this.errors.delete(config.name);
      this.states.set(config.name, 'connected');
      return true;
    } catch (error) {
      if (error instanceof McpAuthenticationRequiredError) this.states.set(config.name, 'authentication-required');
      else this.states.set(config.name, 'failed');
      this.errors.set(config.name, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async stopServer(name: string): Promise<void> {
    await this.clients.get(name)?.stop();
    this.clients.delete(name);
    this.states.set(name, 'stopped');
  }

  async restartServer(name: string): Promise<boolean> {
    await this.stopServer(name);
    const config = loadMcpConfig().servers.find((server) => server.name === name);
    return config ? this.startServer(config) : false;
  }

  async login(name: string, onUrl?: (url: string) => void): Promise<number> {
    const config = loadMcpConfig().servers.find((server) => server.name === name);
    if (!config) throw new Error(`MCP server "${name}" not found`);
    if (config.type !== 'http' || config.auth !== 'oauth') throw new Error(`MCP server "${name}" is not configured for OAuth`);
    this.states.set(name, 'authenticating');
    try {
      await beginOAuthLogin(name, config.url, config.oauth, this.errors.get(name), onUrl);
      const ok = await this.restartServer(name);
      if (!ok) throw new Error(this.errors.get(name) || 'MCP connection failed after OAuth');
      return this.clients.get(name)?.tools.length || 0;
    } catch (error) {
      this.states.set(name, 'authentication-required');
      this.errors.set(name, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async completeCallback(name: string, redirectUrl: string): Promise<void> {
    await completeOAuthCallback(name, redirectUrl);
  }

  async logout(name: string): Promise<void> {
    const client = this.clients.get(name);
    await client?.stop();
    this.clients.delete(name);
    removeOAuth(name);
    this.states.set(name, 'authentication-required');
    this.errors.set(name, 'Authentication required');
  }

  getClient(name: string): McpClient | undefined { return this.clients.get(name); }
  getAllClients(): Map<string, McpClient> { return this.clients; }

  getStatus(): McpServerStatus[] {
    return loadMcpConfig().servers.map((server) => {
      const client = this.clients.get(server.name);
      return {
        name: server.name,
        enabled: server.enabled,
        running: client?.running ?? false,
        state: server.enabled ? this.states.get(server.name) || 'stopped' : 'disabled',
        transport: server.type,
        toolCount: client?.tools.length || 0,
        description: server.description,
        error: this.errors.get(server.name),
      };
    });
  }

  getToolCount(): number { return [...this.clients.values()].reduce((count, client) => count + client.tools.length, 0); }

  async healthCheck(name: string): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    const client = this.clients.get(name);
    if (!client?.running) return { healthy: false, error: this.errors.get(name) || 'Server not running' };
    const started = Date.now();
    try { await client.listTools(); return { healthy: true, latency: Date.now() - started }; }
    catch (error) { return { healthy: false, error: error instanceof Error ? error.message : String(error) }; }
  }

  autoDiscover(): McpServerConfig[] {
    const existing = new Set(loadMcpConfig().servers.map((server) => server.name));
    return Object.entries(PRESET_SERVERS).filter(([name]) => !existing.has(name)).map(([name, preset]) => ({ name, ...preset, enabled: false } as McpServerConfig));
  }
}

export const mcpManager = new McpServerManager();
