# Feature: Multi-Agent Orchestration

## Purpose

Multi-Agent Orchestration is Aurix's system for splitting difficult work across specialist agents, deep research stages, and parallel sub-agent jobs.

This feature powers:

- `/depth high`, `/depth xhigh`, `/depth max`, and `/depth ultra`.
- `/deep` and `/deep-research`.
- Native specialist routing in `MultiAgentSystem`.
- The `spawn_agent` tool for explicit fan-out.
- `/agents` job dashboards.
- Research pipelines with claim extraction, debate, citation checking, and final review.

This is a core Aurix feature.
It deserves its own doc because it crosses agent loop routing, tools, persistent jobs, CLI UI, gateway commands, and research agents.

## User-facing commands

CLI commands:

```txt
/depth <low|medium|high|xhigh|max|ultra>
/effort <low|medium|high|xhigh|max|ultra>
/deep
/deep-research <topic>
/agents
/fast
/status
```

Gateway commands:

```txt
/depth <low|medium|high|xhigh|max|ultra>
/agents
/fast
/status
```

WhatsApp equivalents use the `!ai` prefix:

```txt
!ai depth high
!ai agents
!ai fast
```

Model-facing tool:

```txt
spawn_agent
```

Use `spawn_agent` when subtasks are independent enough to run concurrently.
Do not use it for tiny single-step questions.

## Config

Persistent config field:

```yaml
researchMode: low   # low | medium | high | xhigh | max | ultra
```

TypeScript field:

```ts
researchMode?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
```

Default:

```txt
low
```

`/depth`, `/effort`, `/deep`, and `/fast` update `config.researchMode` and save config.

## Source files

Primary files:

- `src/agent/AgentLoop.ts`
- `src/agent/MultiAgent.ts`
- `src/agent/ResearchPipeline.ts`
- `src/tools/SpawnAgent.ts`
- `src/agent/SessionStore.ts`

Related files:

- `src/cli/App.tsx` for command handlers and orchestrator UI.
- `src/cli/commands.ts` for slash command metadata.
- `src/gateway/Gateway.ts` for gateway `/depth`, `/agents`, and `/fast` parity.
- `src/agent/Context.ts` for deep research mode instructions.
- `src/agent/research/*` for individual research-stage agents.
- `src/agent/ToolEventRenderer.ts` for readable `spawn_agent` and research events.

## Execution mode selection

`AgentLoop.run()` chooses one of three paths:

```txt
single
research
multiagent
```

Selection uses:

- `getResearchMode()`
- `looksLikeResearchTask()`
- `looksLikeComplexTask()`
- `selectExecutionMode()`

Current high-level rules:

- `low` uses normal single-agent execution.
- `medium` stays single-agent unless explicit multi-agent mode is enabled.
- Higher depths route research-like tasks to `runResearch()`.
- Higher depths route complex code/repo tasks to `runMultiAgent()`.
- Image-attached turns stay single-agent first so vision fallback can process images correctly.

Small tasks should stay fast.
Do not route every prompt to multi-agent.

## Native specialist routing

`src/agent/MultiAgent.ts` defines specialists.

Coding specialists:

- `web-dev`
- `frontend`
- `backend`
- `ui-designer`
- `code-reviewer`
- `cybersecurity`

Academic/research specialists:

- `researcher`
- `journal-writer`
- `data-analyst`
- `editor`

Meta specialists:

- `user-advocate`
- `judge`

The supervisor asks the model to choose `direct` or `multi-agent` and select 1–3 specialists.
If the model response is malformed or empty, `fallbackPlan()` chooses specialists from keyword rules.

## Native multi-agent flow

1. `AgentLoop.run()` selects `multiagent`.
2. `runMultiAgent()` appends the user message to durable session state with metadata `{ mode: 'multiagent' }`.
3. `MultiAgentSystem.run()` calls `supervisorPlan()`.
4. If route is `direct`, it returns a direct response.
5. If route is `multi-agent`, it selects up to `MAX_SPECIALISTS` specialists.
6. Each selected specialist gets a fresh `AgentLoop`.
7. Specialist registries include only their allowed tools.
8. Specialist sub-agents run with `researchMode: 'low'` to prevent recursive routing.
9. Specialist events are forwarded to the parent loop.
10. If more than one specialist ran, `judge` synthesizes the final answer.
11. The parent loop appends the final answer to durable session state.

## Explicit `spawn_agent` tool

`src/tools/SpawnAgent.ts` exposes `spawn_agent` for model-directed fan-out inside a normal turn.

Tool input:

```json
{
  "tasks": [
    "Inspect the API layer and report risks",
    "Inspect the UI layer and report risks"
  ]
}
```

Important limits:

```txt
MAX_AGENTS = 12
MAX_CONCURRENCY = 3
SUBAGENT_MAX_ITERATIONS = 40
```

Behavior:

1. Validate `tasks` is a non-empty array.
2. Trim empty tasks.
3. Cap task count.
4. Lazy-import `AgentLoop` and `ToolRegistry` to avoid circular imports.
5. Clone the parent registry but remove `spawn_agent`.
6. Create a persisted `agent_jobs` row.
7. Emit `orchestratorEvents` for UI/dashboard status.
8. Run sub-agents with bounded concurrency.
9. Update completed counts in `SessionStore`.
10. Return a combined result grouped by sub-agent.

Removing `spawn_agent` from sub-agent registries is a hard invariant.
It prevents recursive fan-out explosions.

## Research pipeline

`src/agent/ResearchPipeline.ts` is separate from native coding specialists.

Depth controls active stages:

- `low`: direct answer.
- `medium`: request analysis, research, writer.
- `high`: planning, research, video, claim extraction, supporter, skeptic, judge, citation guardian, writer.
- `xhigh`: adds formal debate.
- `max`: adds logic critic.
- `ultra`: adds final reviewer.

Research stage files live under:

```txt
src/agent/research/
```

Important stages:

- `RequestAnalyzer`
- `PlanningAgent`
- `ResearchAgent`
- `VideoAgent`
- `ClaimExtractor`
- `SupporterAgent`
- `SkepticAgent`
- `DebateSystem`
- `JudgeAgent`
- `CitationGuardian`
- `LogicCritic`
- `WriterAgent`
- `FinalReviewer`

Research events are persisted as tool events named like `research:ResearchAgent`.

## Durable job model

Agent jobs are stored in `~/.aurix/state/aurix.sqlite` through `SessionStore`.

Table shape:

```sql
agent_jobs(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  total_agents INTEGER,
  completed_agents INTEGER DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  last_status TEXT
)
```

TypeScript summary:

```ts
interface AgentJobSummary {
  id: string;
  kind: string;
  prompt: string;
  status: 'running' | 'success' | 'error';
  totalAgents?: number;
  completedAgents?: number;
  startedAt: string;
  finishedAt?: string;
  lastStatus?: string;
}
```

`/agents` should show recent persisted jobs and completion counts.

## UI and gateway behavior

CLI listens to `orchestratorEvents` from `SpawnAgent.ts`.

Expected visible states:

- job started
- sub-agent queued
- sub-agent thinking
- sub-agent running tool
- sub-agent done/crashed
- job ended

Gateway `/agents` reads persisted jobs from `SessionStore`.

Gateway should not spam every sub-agent event into chat unless explicitly designed.
A compact dashboard is preferred.

## Invariants to preserve

- `low` depth must remain fast and single-agent.
- `spawn_agent` must be removed from sub-agent registries.
- Specialist sub-agents must run with `researchMode: 'low'`.
- Tool allowlists for specialists must be honored.
- Native specialist count must stay bounded.
- Explicit `spawn_agent` task count and concurrency must stay bounded.
- Sub-agent failures must be returned as structured text, not crash the CLI.
- Agent jobs must persist status and completion counts.
- Research pipeline depth must map predictably to active stages.
- `/fast` must restore low-depth single-agent behavior.
- Gateway and CLI must agree on valid depth names.

## What not to break

Do not replace native orchestration with an external framework unless there is a clear migration plan.

Do not let sub-agents recursively spawn more sub-agents.

Do not give every specialist every tool by default.

Do not route simple prompts to high-cost multi-agent mode.

Do not claim parallelism if tasks are actually run sequentially.

Do not hide sub-agent crashes.
Surface them in job status or final combined output.

Do not add a new depth level without updating CLI, gateway, config type, context prompt, and docs together.

## Common failure modes

### Recursive fan-out

Cause: a sub-agent can call `spawn_agent`.

Expected prevention: `buildSubRegistry()` and specialist registries exclude `spawn_agent`.

### Multi-agent used for trivial prompts

Cause: over-broad routing keywords or bad default depth.

Expected behavior: keep default `researchMode` as `low`, and keep `direct` route available.

### Missing job dashboard data

Cause: `recordAgentJobStart()` or `updateAgentJob()` was skipped.

Expected behavior: `/agents` shows running/recent jobs created through `spawn_agent`.

### Specialist has wrong tools

Cause: tool allowlist omitted a required tool or included an unrelated one.

Expected behavior: update specialist `tools` intentionally and keep scopes narrow.

### Research pipeline produces weak citations

Cause: low/medium depth does not run citation guardian.

Expected behavior: tell users to use `/depth high` or `/deep-research` for citation-heavy work.

### Gateway chat spam

Cause: every sub-agent status is sent directly to chat.

Expected behavior: prefer compact `/agents` dashboard and final summaries.

## Verification checklist

Run static checks:

```bash
npx tsc --noEmit
npm run build
```

CLI depth smoke:

```txt
/status
/depth low
/status
/depth high
/status
/fast
/status
```

Research smoke:

```txt
/depth high
/deep-research compare SearXNG vs DuckDuckGo for agent search
```

Expected:

- Research events show pipeline stages.
- Final answer is produced.
- No recursive multi-agent explosion.

Spawn-agent smoke:

```txt
Use sub-agents to inspect docs/features and report missing feature docs.
```

Expected:

- At most 3 sub-agents run concurrently.
- `/agents` shows a persisted job.
- Combined output groups results by sub-agent.

Gateway smoke:

```txt
/depth high
/agents
/fast
/status
```

Expected:

- Depth changes persist.
- `/agents` returns a compact dashboard or clear empty-state message.

## Editing guidance for AI agents

Before changing multi-agent behavior:

1. Read `src/agent/AgentLoop.ts` execution-mode selection and `runMultiAgent()`.
2. Read `src/agent/MultiAgent.ts` specialist definitions and routing.
3. Read `src/tools/SpawnAgent.ts` explicit fan-out tool limits.
4. Read `src/agent/ResearchPipeline.ts` depth-stage mapping.
5. Read `src/agent/SessionStore.ts` `agent_jobs` methods if job status changes.
6. Check CLI handlers in `src/cli/App.tsx`.
7. Check gateway handlers in `src/gateway/Gateway.ts`.
8. Update `src/cli/commands.ts` if user-facing commands change.
9. Run typecheck and build.
10. Smoke test `/depth`, `/fast`, `/agents`, and one fan-out task.

When in doubt, preserve boundedness first.
A slightly less ambitious multi-agent system is better than one that recursively spawns unbounded agents or floods the user's chat.