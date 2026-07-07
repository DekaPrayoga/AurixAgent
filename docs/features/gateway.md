# Feature: Gateway

## Purpose

Gateway lets Aurix run from messaging platforms instead of only the terminal.

It connects the same agent loop, tools, durable sessions, scheduled automations, and command system to:

- Discord
- Telegram
- WhatsApp

The goal is cross-platform continuity.
A user should be able to start work in chat, resume it later, and still use the same memory, tools, and state as the CLI.

## User-facing behavior

Gateway mode starts with:

```bash
aurix gateway
```

Platform credentials live in:

```txt
~/.aurix/config.yaml
```

Typical config shape:

```yaml
gateway:
  discord:
    enabled: true
    token: "..."
    allowedUsers:
      - "123456789"
  telegram:
    enabled: true
    token: "..."
    allowedUsers:
      - "123456789"
  whatsapp:
    enabled: true
    allowedUsers:
      - "+6281234567890"
```

Setup path:

```bash
aurix setup
```

If no platforms are configured, gateway mode should show setup guidance instead of failing with an unclear token error.

## Command prefixes

Discord and Telegram use slash-style commands:

```txt
/start
/help
/status
/history
/history-search geetest
/resume latest geetest
/cron
```

WhatsApp uses the `!ai` prefix:

```txt
!ai start
!ai status
!ai history-search geetest
!ai resume latest geetest
```

Plain non-command text becomes an agent prompt when the platform parser allows it.

## Source files

Primary files:

- `src/gateway/Gateway.ts`
- `src/gateway-entry.ts`
- `src/gateway/Discord.ts`
- `src/gateway/Telegram.ts`
- `src/gateway/WhatsApp.ts`
- `src/gateway/WASessionStore.ts`

Related files:

- `src/agent/AgentLoop.ts` for the shared agent runtime.
- `src/agent/Config.ts` for gateway config schema.
- `src/agent/Setup.ts` for gateway setup prompts.
- `src/agent/CronDaemon.ts` for scheduled gateway delivery.
- `src/agent/SessionStore.ts` for durable shared sessions.
- `src/tools/SendFile.ts` for sending generated files back to gateway chats.
- `src/tools/Registry.ts` for the shared tool registry.

## Runtime flow

1. User runs `aurix gateway`.
2. `src/index.tsx` routes to `startGateway()` in `src/gateway-entry.ts`.
3. `startGateway()` loads config.
4. It creates or receives the tool registry.
5. It creates `new Gateway(config, registry)`.
6. Enabled platform adapters are registered.
7. `createSendFileTool(gateway)` is registered for artifact delivery.
8. `gateway.start()` starts all registered platforms.
9. Each platform emits normalized incoming messages.
10. Gateway command text routes through command handlers.
11. Regular text routes into an `AgentLoop` keyed by platform/user/channel.
12. Agent events are streamed back as gateway-safe status messages.
13. Final text is formatted for the target platform and sent to the chat.

## Platform interface

Gateway platforms implement this common shape:

```ts
interface GatewayPlatform {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(text: string, channelId: string, replyTo?: string): Promise<void>;
  sendFile?(file: string, channelId: string, replyTo?: string): Promise<void>;
  typing?(channelId: string): Promise<void>;
  on(event: 'message', handler: (msg: IncomingMessage) => void): this;
}
```

Keep adapters thin.

Do not put core agent behavior in Discord, Telegram, or WhatsApp adapters.
Gateway orchestration belongs in `Gateway.ts`.
Agent reasoning belongs in `AgentLoop.ts`.

## Session model

Gateway sessions must be stable enough that the same user can continue work across messages.

Key concepts:

- `agentKey` identifies the active agent instance for a platform/user/channel.
- `sessionNames` tracks human-friendly titles assigned by `/title`.
- `AgentLoop` persists durable sessions through `SessionStore`.
- `/history-search` queries durable sessions.
- `/resume latest [query]` loads the newest matching durable session.

Rules:

- `/reset` clears active conversation state, not durable history.
- `/save` stores the current session.
- `/title <name>` stores a resumable name.
- `/resume <id>` interrupts current work, creates/loads the requested agent, and continues with loaded messages.
- `/resume latest <query>` resolves the newest matching session before loading.

## Gateway commands

Keep the command guide in `Gateway.ts` accurate.

Session commands:

- `/start`
- `/help`
- `/reset`
- `/cancel`
- `/title [name]`
- `/resume [name]`
- `/history-search <query>`
- `/save`
- `/status`
- `/history`

Configuration commands:

- `/model <name>`
- `/baseurl <url>`
- `/apikey <key>`
- `/depth <level>`
- `/fast`

Feature commands:

- `/tools`
- `/skills`
- `/review`
- `/plan`
- `/research <topic>`
- `/research-forums <topic>`
- `/summarize`
- `/pdf <content>`
- `/pptx <topic>`
- `/xlsx <topic>`
- `/compress`
- `/agents`
- `/cron`
- `/btw <text>`

When command behavior changes, update:

- `COMMAND_GUIDE`
- `WA_COMMAND_GUIDE`
- `KNOWN_COMMANDS`
- CLI command docs if there is CLI parity

## Formatting rules

Gateway output must be readable on mobile.

Preserve these rules:

- Clean raw model text before sending.
- Convert or strip markdown that breaks platform rendering.
- Keep status updates compact.
- Avoid huge tables unless converted to readable text.
- Send files as attachments when supported.
- Truncate or summarize very long tool output.
- Do not spam a chat with every tiny stream chunk.

`gatewayText()` and related helpers centralize platform-safe rendering.

If a change touches rendering, test one long markdown response and one table-like response.

## Tool event behavior

Gateway users should see progress without being flooded.

Expected events:

- Thinking started.
- Tool started.
- Tool completed with duration/result preview.
- Tool error.
- File generated and ready.
- Final answer.

Rules:

- Prefer editing/updating an existing status message when platform APIs allow it.
- If editing is not possible, send fewer updates.
- Never expose raw secrets from tool arguments.
- Render tool names in human-readable form.
- Keep delivery failures visible but non-fatal to the agent loop.

## File delivery

`src/tools/SendFile.ts` uses gateway context to send generated artifacts.

Flow:

1. Gateway records recent context.
2. The agent/tool generates a local file.
3. The send-file tool resolves platform/channel.
4. The platform sends an attachment if supported.
5. If unsupported, gateway sends a clear fallback path/message.

Do not assume every platform supports files equally.

Generated file delivery should not block the final text answer when a platform attachment API fails.

## WhatsApp session store

WhatsApp uses Baileys and stores auth/session state through `WASessionStore.ts`.

That store is separate from Aurix conversation state.

Do not confuse:

- WhatsApp auth/session persistence.
- Aurix durable conversation/session persistence.

WhatsApp auth state must remain stable across restarts or the user will need to scan QR repeatedly.

## Security and access control

Gateway bots can be exposed to groups and public chats.

Preserve these rules:

- Honor `allowedUsers` when configured.
- Do not log full tokens.
- Do not echo `/apikey` values back to chat.
- Do not store raw secrets in searchable session text.
- Do not let unauthorized users control tools through group chats.
- Treat platform user ids and phone numbers as identity inputs.

If `allowedUsers` is empty, the bot is open to anyone who can message it.

## Cron integration

Gateway can provide a delivery target for scheduled jobs.

Rules:

- Jobs created from a chat should remember platform/channel/reply target when supported.
- Scheduled output should return to the originating chat.
- Cron delivery should use gateway formatting, not raw terminal formatting.
- A failed cron delivery should be recorded without crashing the daemon.

See `docs/features/cron-automation.md` for scheduler details.

## Invariants to preserve

- Gateway mode must start with any single configured platform.
- Configured tokens must not be printed in full.
- Active agent work must be cancellable with `/cancel`.
- Message queues must prevent overlapping tasks for the same user/session.
- `/btw` must add context without corrupting current tool calls.
- `/resume` must interrupt old work before loading a new session.
- `/history-search` must use durable session search.
- Gateway and CLI sessions must share the same persistence layer.
- Status formatting must not break Discord/Telegram/WhatsApp rendering.
- Platform shutdown must stop adapters cleanly.

## What not to break

Do not make gateway depend on the TUI.

Do not duplicate full CLI logic into every platform adapter.

Do not create platform-specific command behavior unless the platform requires it.

Do not remove WhatsApp prefix handling.

Do not send raw stack traces to gateway users unless debug mode is explicit.

Do not store gateway tokens in docs, tests, or snapshots.

Do not turn a delivery failure into a full agent failure unless the task was only delivery.

## Common failure modes

### Bot starts with no platforms

Expected behavior:

- Show config YAML example.
- Mention `aurix setup`.
- Exit cleanly or remain idle without unclear token errors.

### Unauthorized user

Expected behavior:

- Reject the message.
- Do not run tools.
- Do not leak whether other users are authorized.

### Markdown table unreadable on mobile

Expected behavior:

- Use gateway formatting helpers.
- Convert to compact text/table rendering.

### Long-running task spams chat

Expected behavior:

- Throttle updates.
- Summarize chunks.
- Preserve final answer clarity.

### WhatsApp auth lost

Expected behavior:

- Check `WASessionStore.ts` persistence.
- Do not delete auth DB during conversation cleanup.

## Verification checklist

Run static checks:

```bash
npx tsc --noEmit
npm run build
```

Gateway startup smoke:

```bash
aurix gateway
```

Command smoke in a platform chat:

```txt
/status
/history
/history-search test
/resume latest test
/tools
/agents
/cron
```

WhatsApp smoke:

```txt
!ai status
!ai history-search test
```

File smoke:

1. Ask Aurix to generate a PDF/screenshot/file.
2. Confirm the file is attached or a clear fallback path is sent.

Persistence smoke:

1. Send a prompt from gateway.
2. Save or title the session.
3. Open CLI.
4. Use `/history-search <word-from-prompt>`.
5. Confirm the gateway session appears.

## Editing guidance for AI agents

Before changing gateway behavior:

1. Read `src/gateway/Gateway.ts` around command parsing and event handling.
2. Read the relevant platform adapter.
3. Read `src/agent/Config.ts` gateway config type.
4. Read `src/agent/Setup.ts` `stepGateway()` if config changes.
5. Check command parity with `src/cli/commands.ts` and `src/cli/App.tsx`.
6. Update this doc if user commands, config shape, or persistence behavior changes.
7. Run typecheck and build.
8. Smoke test at least one configured platform.

Keep gateway boring and robust.
It is a delivery surface for Aurix, not a separate agent implementation.