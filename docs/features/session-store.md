# Feature: Session Store

## Purpose

Session Store is Aurix's durable state spine.

It stores:

- sessions
- messages
- tool events
- evidence items
- scheduled jobs
- scheduled job runs
- agent jobs
- searchable text index when FTS is available

The goal is to make Aurix persistent across restarts and usable from CLI and gateway contexts.

## Source files

Primary file:

- `src/agent/SessionStore.ts`

Main callers:

- `src/agent/AgentLoop.ts`
- `src/agent/MemoryEngine.ts`
- `src/agent/CronDaemon.ts`
- `src/tools/SpawnAgent.ts`
- `src/cli/App.tsx`
- `src/gateway/Gateway.ts`

## Storage path

Default SQLite file:

```txt
~/.aurix/state/aurix.sqlite
```

Implementation uses `sql.js`.

This is a SQLite database persisted by exporting the in-memory database to a file.

## Tables

Core session tables:

- `sessions`
- `messages`
- `tool_events`
- `session_fts`

Reliability tables:

- `evidence_items`
- `verification_runs`

Autonomy tables:

- `scheduled_jobs`
- `scheduled_job_runs`
- `agent_jobs`

## Runtime flow: sessions

1. `AgentLoop` creates or receives a session key.
2. It derives a durable session id.
3. On a turn, it upserts the session.
4. It appends user messages.
5. It appends assistant messages.
6. It records tool start/end/chunk events.
7. It records evidence when terminal commands look like test/build/typecheck/lint/deploy.
8. Search and resume commands query the store.

## Runtime flow: search/resume

CLI commands:

```txt
/history-search <query>
/resume latest [query]
/sessions
/history
```

Gateway commands:

```txt
/history-search <query>
/resume latest [query]
```

Search behavior:

- Prefer FTS5 when available.
- Fall back to LIKE queries when FTS is not available.
- Search messages, tool event previews, and evidence labels/results.

Resume behavior:

- Load SQLite messages first.
- Fall back to legacy JSON sessions through `MemoryEngine` where applicable.

## Runtime flow: tool events

Tool events record:

- tool name
- args JSON
- phase
- result preview
- result path
- status
- duration
- error type

Use tool events for:

- tool history
- usage stats
- workflow pattern detection
- evidence correlation
- gateway progress rendering

## Runtime flow: evidence

Evidence items record verification facts.

Examples:

- typecheck passed
- build failed
- test skipped
- deploy completed

Do not fabricate evidence. Only record commands that actually ran.

## Runtime flow: cron jobs

Cron uses:

- `scheduled_jobs`
- `scheduled_job_runs`

One scheduled job may have many runs.

One run should be inserted as `running`, then updated to `success` or `error`.

## Runtime flow: agent jobs

`spawn_agent` persists:

- job id
- kind
- prompt summary
- status
- total agent count
- completed agent count
- started/finished timestamps
- last status

CLI and gateway `/agents` use this table for dashboards.

## Invariants to preserve

- Redact credentials before storing searchable text.
- Keep writes durable by calling `save()` after mutations.
- Do not silently overwrite a DB that changed on disk from another process.
- FTS failures must degrade to LIKE search.
- Missing tables/columns should be created by migration.
- Schema additions must be backward-compatible.
- Session loading must tolerate malformed JSON fields.
- Do not store huge full outputs in DB; store previews and paths.

## Multi-process warning

`sql.js` is not a normal native SQLite connection. It loads the DB into memory and writes the whole DB back to disk.

This means concurrent Aurix processes can conflict.

Current safety rule:

- If the DB file changed on disk after this process loaded it, do not silently overwrite it.
- Throw a clear error asking for restart/avoiding concurrent writers.

Future improvement:

- Replace sql.js with a native SQLite driver or a single state daemon if multi-process writes become common.

## Common failure modes

### Lost session history

Cause:

- Concurrent process overwrite.

Expected behavior:

- Detect changed DB and throw instead of overwriting.

### FTS unavailable

Cause:

- sql.js build lacks FTS5.

Expected behavior:

- Continue with LIKE search.

### Huge outputs slow DB

Cause:

- Full tool results inserted instead of previews.

Expected behavior:

- Store previews and optional output paths.

### Bad JSON field

Cause:

- Older data or manual DB editing.

Expected behavior:

- Parse with fallback.

## Verification checklist

Run:

```bash
npx tsc --noEmit
npm run build
```

Manual smoke:

1. Start Aurix.
2. Send a prompt.
3. Use a tool.
4. Exit and restart.
5. Run `/history-search <term>`.
6. Run `/resume latest <term>`.
7. Confirm messages load.

Cron smoke:

```txt
/cron add */5 * * * * | say state smoke
/cron run <id>
/cron list
/cron remove <id>
```

Agent job smoke:

1. Ask Aurix to spawn subagents.
2. Run `/agents`.
3. Confirm persisted job status appears.

## Editing guidance for AI agents

Before editing SessionStore:

1. Read the schema in `migrate()`.
2. Check all callers of the method you change.
3. Preserve backward compatibility.
4. Redact text before persistence.
5. Keep FTS optional.
6. Run typecheck and build.

Do not add a table without adding migration and read/write helpers.
