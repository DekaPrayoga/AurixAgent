# Feature: Cron Automation

## Purpose

Cron Automation lets Aurix run recurring autonomous tasks without a human sending a new prompt each time.

Examples:

- Send a daily AI news digest.
- Run a scheduled repository health check.
- Summarize gateway/channel activity.
- Run periodic research and deliver the result to Telegram or Discord.

This feature is part of the autonomy spine. It is deliberately built on durable state so jobs survive process restarts.

## User-facing commands

CLI:

```txt
/cron list
/cron add <cron expr> | <prompt>
/cron run <id>
/cron remove <id>
```

Gateway:

```txt
/cron list
/cron add <cron expr> | <prompt>
/cron run <id>
/cron remove <id>
```

## Examples

Daily at 09:00:

```txt
/cron add 0 9 * * * | research China AI news and summarize the most important changes
```

Every hour:

```txt
/cron add 0 * * * * | check project health and report only failures
```

Manual run:

```txt
/cron run cron_ab12cd34ef
```

Remove:

```txt
/cron remove cron_ab12cd34ef
```

## Config

Cron jobs are not stored in `config.yaml`.

They are stored in SQLite under:

```txt
~/.aurix/state/aurix.sqlite
```

Relevant tables:

- `scheduled_jobs`
- `scheduled_job_runs`

## Source files

Primary files:

- `src/agent/CronDaemon.ts`
- `src/agent/SessionStore.ts`
- `src/cli/App.tsx`
- `src/gateway/Gateway.ts`
- `src/index.tsx`

Related files:

- `src/agent/AgentLoop.ts`
- `src/tools/SpawnAgent.ts`
- `src/agent/ToolEventRenderer.ts`

## Runtime flow

1. Aurix starts.
2. `src/index.tsx` creates a `CronDaemon` after the tool registry is built.
3. `CronDaemon.start()` loads active jobs from `SessionStore`.
4. Each active job is registered with `node-cron`.
5. When the schedule fires, `CronDaemon.runJob(id)` runs.
6. `runJob()` creates an `AgentLoop` with session key `cron:<id>`.
7. The prompt is wrapped as a cron-triggered autonomous task.
8. The agent runs with normal tools and final response capture.
9. `scheduled_job_runs` is updated from `running` to `success` or `error`.
10. If the job was created from a gateway and has a target channel, the final response is delivered to that channel.

## Gateway delivery model

Gateway-created jobs store:

- `targetPlatform`
- `targetChannelId`
- `targetReplyTo`

The gateway sets a delivery callback on the shared `CronDaemon`.

Important invariant:

- In the TUI process, gateway connections must reuse the CLI daemon.
- Do not start a second daemon for the same process when a gateway is connected from the TUI.
- Standalone `aurix gateway` may create its own daemon.

## Data model

`scheduled_jobs` should represent the job definition.

Fields:

- `id`
- `schedule`
- `prompt`
- `status`
- `target_platform`
- `target_channel_id`
- `target_reply_to`
- `created_at`
- `updated_at`
- `last_run_at`

`scheduled_job_runs` should represent each execution attempt.

Fields:

- `id`
- `job_id`
- `started_at`
- `finished_at`
- `status`
- `result_preview`
- `error`

One logical execution should be one row. Create it as `running`, then update the same row to `success` or `error`.

## Invariants to preserve

- Never duplicate schedule registration inside the same process.
- Never record delivery success before delivery actually succeeds.
- Never insert a second completion row for one run.
- Always use a timeout-aware tool path inside the agent where possible.
- Keep cron prompt text concise but explicit.
- Do not store secrets in job prompts.
- Do not allow invalid cron expressions.
- If a job is removed, stop its in-memory scheduled task.
- If delivery fails, the run should be marked `error`.

## Common failure modes

### Duplicate daemon

Symptom:

- One scheduled job runs twice.

Cause:

- TUI starts a daemon, then a gateway connection starts another daemon.

Fix:

- Pass the existing daemon into `Gateway`.
- Use `setDelivery()` instead of constructing a second daemon.

### Stale running run row

Symptom:

- Run history shows jobs still running forever.

Cause:

- Code inserted a `running` row then inserted a new `success` row.

Fix:

- Keep the run id and update the same row.

### Gateway delivery failure

Symptom:

- Cron job shows success but user never receives output.

Cause:

- Result was persisted as success before delivery completed.

Fix:

- Deliver first, then record success.

### Multi-process state conflict

Symptom:

- Jobs or run records disappear.

Cause:

- Multiple Aurix processes write the sql.js DB file.

Expected behavior:

- Do not silently overwrite a DB file that changed on disk.
- Fail loudly and tell the user to restart/avoid concurrent writers.

## Verification checklist

Run:

```bash
npx tsc --noEmit
npm run build
```

Manual CLI smoke:

```txt
/cron list
/cron add */5 * * * * | say cron smoke test
/cron list
/cron run <id>
/cron remove <id>
```

Manual gateway smoke:

```txt
/cron add */5 * * * * | send a one sentence gateway smoke test
/cron run <id>
```

Confirm:

- The run is persisted.
- The output is delivered to the same gateway channel.
- Removing the job prevents future runs.

## Editing guidance for AI agents

Before editing cron:

1. Read `CronDaemon.ts`.
2. Read `SessionStore.ts` scheduled job methods.
3. Read CLI `/cron` handler in `App.tsx`.
4. Read gateway `/cron` handler in `Gateway.ts`.
5. Check whether the change affects delivery or persistence.
6. Run typecheck and build.

Do not add cron behavior that only works in CLI and not gateway unless documented.
