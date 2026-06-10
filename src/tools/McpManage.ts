import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Tool } from '../tools/Registry.js';

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
  const existing = config.servers.findIndex(s => s.name === server.name);
  if (existing >= 0) {
    config.servers[existing] = server;
  } else {
    config.servers.push(server);
  }
  saveMcpConfig(config);
}

export function removeMcpServer(name: string): void {
  const config = loadMcpConfig();
  config.servers = config.servers.filter(s => s.name !== name);
  saveMcpConfig(config);
}

export const PRESET_SERVERS: Record<string, Omit<McpServerConfig, 'name' | 'enabled'>> = {
  github: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '<your-token>' },
    description: 'GitHub integration (repos, PRs, issues, actions)',
  },
  gmail: {
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-gmail'],
    description: 'Gmail integration (read, send, search emails)',
  },
  google_drive: {
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-google-drive'],
    description: 'Google Drive integration (read, search files)',
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
  filesystem: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/home'],
    description: 'Filesystem access (read/write/search files)',
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
    description: 'Slack integration (channels, messages)',
  },
};

export interface McpToolResult {
  name: string;
  server: string;
  description: string;
  parameters: Record<string, unknown>;
}

export async function listMcpTools(): Promise<McpToolResult[]> {
  const config = loadMcpConfig();
  const tools: McpToolResult[] = [];

  for (const server of config.servers.filter(s => s.enabled)) {
    try {
      const result = await callMcpServer(server, 'tools/list', {});
      if (result?.tools) {
        for (const tool of result.tools) {
          tools.push({
            name: `mcp_${server.name}_${tool.name}`,
            server: server.name,
            description: tool.description || `MCP tool from ${server.name}`,
            parameters: tool.inputSchema || {},
          });
        }
      }
    } catch {
      // Server not running or failed to connect
    }
  }

  return tools;
}

async function callMcpServer(server: McpServerConfig, method: string, params: any): Promise<any> {
  const { spawn } = await import('child_process');

  return new Promise((resolve, reject) => {
    const proc = spawn(server.command, server.args || [], {
      env: { ...process.env, ...server.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });

    let output = '';
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('MCP server timeout'));
    }, 10000);

    proc.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
      try {
        const response = JSON.parse(output);
        clearTimeout(timeout);
        proc.kill();
        resolve(response.result);
      } catch {}
    });

    proc.stderr?.on('data', () => {});

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('close', () => {
      clearTimeout(timeout);
      if (output) {
        try {
          resolve(JSON.parse(output).result);
        } catch {
          reject(new Error('Invalid MCP response'));
        }
      } else {
        reject(new Error('No response from MCP server'));
      }
    });

    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    });

    proc.stdin?.write(request + '\n');
  });
}

export const mcpManageTool: Tool = {
  name: 'mcp_manage',
  description: 'Manage MCP (Model Context Protocol) servers. Add, remove, list, or configure external tool servers like GitHub, Gmail, databases, etc.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'list, add, remove, presets, status, connect' },
      name: { type: 'string', description: 'Server name (for add/remove/connect)' },
      command: { type: 'string', description: 'Server command (for add)' },
      args: { type: 'string', description: 'Server arguments (for add)' },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = args.action as string;
    const config = loadMcpConfig();

    switch (action) {
      case 'list': {
        if (config.servers.length === 0) {
          return 'No MCP servers configured.\n\nUse `/mcp presets` to see available servers.\nUse `/mcp connect github` to add a preset.';
        }
        return config.servers.map(s =>
          `${s.enabled ? '[ON]' : '[OFF]'} ${s.name}: ${s.command} ${(s.args || []).join(' ')}\n  ${s.description || 'No description'}`
        ).join('\n\n');
      }

      case 'presets': {
        return Object.entries(PRESET_SERVERS).map(([name, preset]) =>
          `${name}: ${preset.description}\n  Command: ${preset.command} ${(preset.args || []).join(' ')}\n  ${preset.env ? 'Env: ' + Object.keys(preset.env).join(', ') : ''}`
        ).join('\n\n') + '\n\nUse `/mcp connect <name>` to add a preset.';
      }

      case 'connect':
      case 'add': {
        const name = args.name as string;
        if (!name) return 'Provide a server name. Use `/mcp presets` to see available.';

        const preset = PRESET_SERVERS[name];
        if (preset) {
          addMcpServer({ name, ...preset, enabled: true });
          return `Added MCP server: ${name}\n${preset.description}\n\n${preset.env ? 'Set environment variables:\n' + Object.entries(preset.env).map(([k, v]) => `  export ${k}="${v}"`).join('\n') : ''}\n\nRestart AURIX to connect.`;
        }

        const command = args.command as string;
        if (!command) return `Unknown preset "${name}". Use \`/mcp presets\` or provide --command.`;

        addMcpServer({
          name,
          command,
          args: (args.args as string) ? (args.args as string).split(' ') : [],
          enabled: true,
        });
        return `Added custom MCP server: ${name}`;
      }

      case 'remove': {
        const name = args.name as string;
        if (!name) return 'Provide server name to remove.';
        removeMcpServer(name);
        return `Removed MCP server: ${name}`;
      }

      case 'status': {
        const enabled = config.servers.filter(s => s.enabled);
        return `${config.servers.length} servers configured (${enabled.length} enabled)\nConfig: ${MCP_CONFIG_FILE}`;
      }

      default:
        return `Unknown action: ${action}. Use: list, add, remove, presets, connect, status`;
    }
  },
};
