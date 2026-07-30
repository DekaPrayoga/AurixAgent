import type { Tool } from './Registry.js';
import {
  MCP_CONFIG_FILE,
  PRESET_SERVERS,
  addMcpServer,
  loadMcpConfig,
  removeMcpServer,
  type McpServerConfig,
} from '../mcp/McpRegistry.js';

export const mcpManageTool: Tool = {
  name: 'mcp_manage',
  description: 'Install and manage MCP servers in ~/.aurix/mcp.json. Supports HTTP and stdio transports. After installation tell the user: MCP Installed. Try /reload-mcp, then /mcp.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'list, add, remove, presets, status, connect' },
      name: { type: 'string', description: 'Server name' },
      type: { type: 'string', description: 'http or stdio' },
      url: { type: 'string', description: 'HTTP MCP endpoint' },
      auth: { type: 'string', description: 'none, oauth, or bearer' },
      command: { type: 'string', description: 'Stdio server command' },
      args: { type: 'string', description: 'Space-separated stdio arguments' },
    },
    required: ['action'],
  },
  async execute(args) {
    const action = String(args.action || '');
    const config = loadMcpConfig();
    if (action === 'list') {
      if (!config.servers.length) return `No MCP servers configured. Add one to ${MCP_CONFIG_FILE}, then run /reload-mcp.`;
      return config.servers.map((server) => {
        const target = server.type === 'http' ? server.url : `${server.command} ${(server.args || []).join(' ')}`;
        return `${server.enabled ? '[ON]' : '[OFF]'} ${server.name} (${server.type}): ${target}`;
      }).join('\n');
    }
    if (action === 'presets') {
      return Object.entries(PRESET_SERVERS).map(([name, preset]) => {
        const target = preset.type === 'http' ? preset.url : `${preset.command} ${(preset.args || []).join(' ')}`;
        return `${name}: ${preset.description || ''}\n  ${preset.type}: ${target}`;
      }).join('\n\n');
    }
    if (action === 'add' || action === 'connect') {
      const name = String(args.name || '').trim();
      if (!name) return 'Provide a server name.';
      const preset = PRESET_SERVERS[name];
      let server: McpServerConfig;
      if (preset) server = { name, ...preset, enabled: true } as McpServerConfig;
      else if (args.url) server = { name, type: 'http', url: String(args.url), auth: (args.auth as any) || 'none', enabled: true };
      else if (args.command) server = { name, type: 'stdio', command: String(args.command), args: String(args.args || '').split(/\s+/).filter(Boolean), enabled: true };
      else return `Unknown preset "${name}". Provide url for HTTP or command for stdio.`;
      addMcpServer(server);
      const login = server.type === 'http' && server.auth === 'oauth' ? ` Run /mcp login ${name} first.` : '';
      return `MCP Installed.${login} Try /reload-mcp, then /mcp.`;
    }
    if (action === 'remove') {
      const name = String(args.name || '').trim();
      if (!name) return 'Provide server name to remove.';
      removeMcpServer(name);
      return `Removed MCP server: ${name}. Try /reload-mcp, then /mcp.`;
    }
    if (action === 'status') {
      return `${config.servers.length} servers configured (${config.servers.filter((server) => server.enabled).length} enabled)\nConfig: ${MCP_CONFIG_FILE}`;
    }
    return `Unknown action: ${action}. Use list, add, remove, presets, connect, or status.`;
  },
};
