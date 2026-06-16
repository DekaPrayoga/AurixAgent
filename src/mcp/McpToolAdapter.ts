import type { Tool } from '../tools/Registry.js';
import { mcpManager } from './McpRegistry.js';
import type { McpToolSchema } from './McpClient.js';

export function createMcpTool(serverName: string, schema: McpToolSchema): Tool {
  return {
    name: `mcp_${serverName}_${schema.name}`,
    description: `[MCP:${serverName}] ${schema.description || schema.name}`,
    parameters: schema.inputSchema as Record<string, unknown>,
    async execute(args) {
      const client = mcpManager.getClient(serverName);
      if (!client || !client.running) {
        return `Error: MCP server "${serverName}" is not running. Use /mcp to restart it.`;
      }
      try {
        const result = await client.callTool(schema.name, args);
        if (typeof result === 'string') return result;
        if (result && typeof result === 'object') {
          const r = result as Record<string, unknown>;
          if (r.content) {
            if (Array.isArray(r.content)) {
              return r.content
                .map((item: any) => item.type === 'text' ? item.text : JSON.stringify(item))
                .join('\n');
            }
            return String(r.content);
          }
          return JSON.stringify(result, null, 2);
        }
        return String(result);
      } catch (e: any) {
        return `MCP tool error (${serverName}/${schema.name}): ${e.message}`;
      }
    },
  };
}

export async function registerMcpTools(registerFn: (tool: Tool) => void): Promise<number> {
  let count = 0;
  for (const [serverName, client] of mcpManager.getAllClients()) {
    for (const schema of client.tools) {
      const tool = createMcpTool(serverName, schema);
      registerFn(tool);
      count++;
    }
  }
  return count;
}

export function unregisterMcpTools(unregisterFn: (name: string) => void): void {
  for (const [serverName, client] of mcpManager.getAllClients()) {
    for (const schema of client.tools) {
      unregisterFn(`mcp_${serverName}_${schema.name}`);
    }
  }
}
