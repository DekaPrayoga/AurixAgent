import type { Tool } from '../tools/Registry.js';
import { mcpManager } from './McpRegistry.js';
import type { McpToolSchema } from './McpClient.js';
import { formatMcpTextResult, withMcpToolDefaults } from './McpResultFormat.js';

export function formatMcpToolResult(result: unknown): string {
  if (typeof result === 'string') return formatMcpTextResult(result);
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (record.content !== undefined) {
      if (Array.isArray(record.content)) {
        return record.content
          .map((item: unknown) => {
            if (item && typeof item === 'object') {
              const entry = item as Record<string, unknown>;
              if (entry.type === 'text') return formatMcpTextResult(String(entry.text || ''));
            }
            const serialized = JSON.stringify(item);
            return serialized === undefined ? formatMcpTextResult(String(item)) : formatMcpTextResult(serialized);
          })
          .join('\n');
      }
      return typeof record.content === 'string'
        ? formatMcpTextResult(record.content)
        : formatMcpTextResult(JSON.stringify(record.content));
    }
    return formatMcpTextResult(JSON.stringify(result));
  }
  return String(result);
}

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
        const result = await client.callTool(schema.name, withMcpToolDefaults(schema.name, args));
        return formatMcpToolResult(result);
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
