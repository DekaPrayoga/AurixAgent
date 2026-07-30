---
name: mcp-self-install
description: Install and configure MCP servers autonomously from a repository, URL, documentation, or user request, then reload them into Aurix.
tags: [mcp, tools, integration, install, oauth]
---

# MCP Self Install

Use this skill whenever the user asks to install, add, connect, configure, or troubleshoot an MCP server.

## Canonical configuration

Aurix reads `~/.aurix/mcp.json`.

Supported HTTP form:

```json
{
  "mcpServers": {
    "server-name": {
      "type": "http",
      "url": "https://example.com/mcp",
      "auth": "none",
      "enabled": true,
      "timeout": 300000,
      "connectTimeout": 60000
    }
  }
}
```

Supported stdio form:

```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@scope/server"],
      "env": { "API_KEY": "${API_KEY}" },
      "enabled": true
    }
  }
}
```

Aurix also accepts a direct top-level map like `{ "server-name": { ... } }`, but always preserve existing entries and write canonical `mcpServers` format.

## Installation workflow

1. Inspect the repository or official documentation before changing config.
2. Find `.mcp.json`, README installation commands, package manifest, transport type, endpoint, required environment variables, auth mode, and timeouts.
3. Prefer HTTP when the provider publishes an HTTP `/mcp` endpoint. Use stdio only when documentation provides a local command.
4. Never invent package names, commands, URLs, environment variables, or credentials.
5. Read existing `~/.aurix/mcp.json`; merge the named server without removing unrelated servers.
6. Never place OAuth access tokens or refresh tokens in `mcp.json`. Use `auth: "oauth"` and direct the user to `/mcp login <name>` when authentication is required.
7. For API keys, reference an environment variable rather than copying a secret into chat or source control.
8. Validate JSON, transport fields, URL, executable availability, and required environment-variable names.
9. Tell the user exactly what was installed and what remains missing.
10. End successful configuration with this exact concise guidance:

```text
MCP Installed. Try /reload-mcp, then /mcp.
```

If OAuth is required, use:

```text
MCP Installed. Run /mcp login <name>, then /reload-mcp and /mcp.
```

## Ares example

Ares publishes:

```json
{
  "ares": {
    "type": "http",
    "url": "https://aresmcp.com/mcp"
  }
}
```

Install it as HTTP with `auth: "oauth"`, `enabled: true`, `timeout: 300000`, and `connectTimeout: 60000`. Never request a pasted Bearer token for Ares.
