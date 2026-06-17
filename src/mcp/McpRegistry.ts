import fs from 'fs';
import path from 'path';
import os from 'os';
import { McpClient } from './McpClient.js';

const MCP_CONFIG_DIR = path.join(os.homedir(), '.aurix', 'mcp');
const MCP_CONFIG_FILE = path.join(MCP_CONFIG_DIR, 'servers.json');

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  description?: string;
}

export interface McpConfig {
  servers: McpServerConfig[];
}

export interface McpServerStatus {
  name: string;
  enabled: boolean;
  running: boolean;
  toolCount: number;
  description?: string;
  error?: string;
}

function ensureDirs(): void {
  if (!fs.existsSync(MCP_CONFIG_DIR)) fs.mkdirSync(MCP_CONFIG_DIR, { recursive: true });
}

export function loadMcpConfig(): McpConfig {
  ensureDirs();
  try {
    if (fs.existsSync(MCP_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(MCP_CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return { servers: [] };
}

export function saveMcpConfig(config: McpConfig): void {
  ensureDirs();
  fs.writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function addMcpServer(server: McpServerConfig): void {
  const config = loadMcpConfig();
  const idx = config.servers.findIndex(s => s.name === server.name);
  if (idx >= 0) config.servers[idx] = server;
  else config.servers.push(server);
  saveMcpConfig(config);
}

export function removeMcpServer(name: string): void {
  const config = loadMcpConfig();
  config.servers = config.servers.filter(s => s.name !== name);
  saveMcpConfig(config);
}

export function toggleMcpServer(name: string): boolean | null {
  const config = loadMcpConfig();
  const server = config.servers.find(s => s.name === name);
  if (!server) return null;
  server.enabled = !server.enabled;
  saveMcpConfig(config);
  return server.enabled;
}

export const PRESET_SERVERS: Record<string, Omit<McpServerConfig, 'name' | 'enabled'>> = {
  github: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '<your-token>' },
    description: 'GitHub repos, PRs, issues, actions',
  },
  filesystem: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', os.homedir()],
    description: 'Filesystem read/write/search',
  },
  postgres: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { DATABASE_URL: 'postgresql://localhost:5432/mydb' },
    description: 'PostgreSQL database queries',
  },
  sqlite: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    env: { SQLITE_DB_PATH: './data.db' },
    description: 'SQLite database queries',
  },
  brave_search: {
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-brave-search'],
    env: { BRAVE_API_KEY: '<your-key>' },
    description: 'Brave web search',
  },
  puppeteer: {
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-puppeteer'],
    description: 'Browser automation (navigate, screenshot, click)',
  },
  slack: {
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-slack'],
    env: { SLACK_BOT_TOKEN: '<your-token>', SLACK_TEAM_ID: '<your-team>' },
    description: 'Slack channels and messages',
  },
  memory: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    description: 'Persistent knowledge graph memory',
  },
  fetch: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    description: 'Fetch and parse web pages',
  },
  sequential_thinking: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    description: 'Structured step-by-step reasoning',
  },
};

export class McpServerManager {
  private clients = new Map<string, McpClient>();
  private errors = new Map<string, string>();

  async startAll(): Promise<void> {
    const config = loadMcpConfig();
    const enabled = config.servers.filter(s => s.enabled);
    await Promise.allSettled(enabled.map(s => this.startServer(s)));
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.clients.values()).map(c => c.stop())
    );
    this.clients.clear();
  }

  async startServer(config: McpServerConfig): Promise<boolean> {
    if (this.clients.has(config.name)) return true;

    const client = new McpClient(config.name, config.command, config.args, config.env);
    try {
      await client.start();
      this.clients.set(config.name, client);
      this.errors.delete(config.name);
      return true;
    } catch (e: any) {
      this.errors.set(config.name, e.message || String(e));
      return false;
    }
  }

  async stopServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.stop();
      this.clients.delete(name);
    }
  }

  async restartServer(name: string): Promise<boolean> {
    await this.stopServer(name);
    const config = loadMcpConfig().servers.find(s => s.name === name);
    if (!config) return false;
    return this.startServer(config);
  }

  getClient(name: string): McpClient | undefined {
    return this.clients.get(name);
  }

  getAllClients(): Map<string, McpClient> {
    return this.clients;
  }

  getStatus(): McpServerStatus[] {
    const config = loadMcpConfig();
    return config.servers.map(s => {
      const client = this.clients.get(s.name);
      return {
        name: s.name,
        enabled: s.enabled,
        running: client?.running ?? false,
        toolCount: client?.tools.length ?? 0,
        description: s.description,
        error: this.errors.get(s.name),
      };
    });
  }

  getToolCount(): number {
    let count = 0;
    for (const client of this.clients.values()) {
      count += client.tools.length;
    }
    return count;
  }

  async healthCheck(name: string): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    const client = this.clients.get(name);
    if (!client || !client.running) {
      return { healthy: false, error: 'Server not running' };
    }

    const start = Date.now();
    try {
      await client.listTools();
      const latency = Date.now() - start;
      return { healthy: true, latency };
    } catch (e: any) {
      return { healthy: false, error: e.message || String(e) };
    }
  }

  async healthCheckAll(): Promise<Record<string, { healthy: boolean; latency?: number; error?: string }>> {
    const results: Record<string, any> = {};
    for (const name of this.clients.keys()) {
      results[name] = await this.healthCheck(name);
    }
    return results;
  }

  autoDiscover(): McpServerConfig[] {
    const discovered: McpServerConfig[] = [];
    const commonServers = ['github', 'filesystem', 'postgres', 'sqlite', 'brave_search', 'puppeteer', 'slack', 'memory', 'fetch'];
    const config = loadMcpConfig();
    const existing = new Set(config.servers.map(s => s.name));

    for (const name of commonServers) {
      if (!existing.has(name) && PRESET_SERVERS[name]) {
        discovered.push({ name, ...PRESET_SERVERS[name], enabled: false });
      }
    }
    return discovered;
  }
}

export const mcpManager = new McpServerManager();
