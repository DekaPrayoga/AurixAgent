# Feature: Agent Observability

## Purpose

Agent Observability is Aurix's durable event layer for understanding what the agent did, replaying timelines, scoring agent quality, and debugging multi-agent/cron/tool behavior.

This feature is built around the observer bus and backs:

- `/replay`
- `/evals`
- agent job timelines
- cron run timelines
- destructive-action audit trails
- future evaluator dashboards

## User-facing commands

```txt
/replay
/replay latest
/replay session <id>
/replay job <id>

/evals
/evals latest
/evals session <id>
/evals job <id>
```

## Runtime flow

1. Producers publish normalized `AgentObserverEvent` objects to `agentObserverBus`.
2. The session sink persists events into SQLite `observer_events`.
3. `/replay` reads the event stream and prints a chronological timeline.
4. `/evals` reads observer events plus evidence/tool results and computes a simple quality score.

## Event producers

- `AgentLoop` — turn start/end, research events, multi-agent route forwarding, tool lifecycle through `SessionStore.recordToolEvent()`.
- `MultiAgentSystem` — supervisor plans, selected specialists, specialist start/end.
- `SpawnAgent` — explicit fan-out job start/end and sub-agent statuses.
- `CronDaemon` — scheduled job add/remove/run/delivery lifecycle.
- `FileOps` — delete/recovery events.

## Storage model

SQLite table:

```sql
observer_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  turn_id TEXT,
  job_id TEXT,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT,
  tool_name TEXT,
  summary TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
)
```

Event shape:

```ts
interface AgentObserverEvent {
  sessionId?: string;
  turnId?: string;
  jobId?: string;
  source: 'agent_loop' | 'multi_agent' | 'spawn_agent' | 'cron' | 'research';
  eventType: string;
  status?: 'running' | 'success' | 'error' | 'timeout' | 'cancelled';
  toolName?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}
```

## `/replay`

`/replay` prints the latest events for a session or job:

```txt
/replay
/replay session sess_xxx
/replay job agent_xxx
```

Example output:

```txt
12:00:01 agent_loop:turn_start running — implement feature
12:00:03 agent_loop:tool_start running read_file
12:00:04 agent_loop:tool_end success read_file
12:00:10 agent_loop:turn_end success — done
```

## `/evals`

`/evals` computes a lightweight score from:

- observer event count,
- tool errors,
- failed observer events,
- evidence passed/failed,
- delete/recovery events.

The initial scoring is intentionally simple and deterministic. It should evolve into richer evaluator agents later.

## Source files

- `src/agent/AgentObserverBus.ts` — typed process-local bus.
- `src/agent/SessionStore.ts` — `observer_events` schema, sink, and query API.
- `src/agent/AgentLoop.ts` — turn/research/multi-agent event producer.
- `src/agent/MultiAgent.ts` — supervisor/specialist event producer.
- `src/tools/SpawnAgent.ts` — explicit sub-agent job event producer.
- `src/agent/CronDaemon.ts` — scheduled automation event producer.
- `src/cli/App.tsx` — `/replay` and `/evals` handlers.

## Invariants to preserve

- Observer listeners must never throw into agent execution.
- Async observer listener failures must be swallowed or isolated.
- Events should be useful without requiring raw private content.
- Do not spam gateway chats with every event; use dashboards and final summaries.
- Prefer one normalized observer event over duplicate producer-specific records when possible.

## Verification checklist

```bash
npx tsc --noEmit
npm run build
```

Manual smoke:

```txt
Send a prompt that uses a tool.
Run /replay and verify tool events appear.
Run /evals and verify a score is produced.
Run a spawn_agent task and check /replay job <id>.
Run /cron run <id> and check observer events.
```
