# Feature: Web Search

## Purpose

Aurix Web Search gives the agent a fast, configurable way to fetch current public web results without forcing the browser automation tool for every lookup.

The feature is intentionally provider-pluggable:

- `ddg` for free default search.
- `searxng` for free metasearch and self-hosted/private search instances.
- `serper` for Google-like results through Serper.dev.
- `tavily` for AI-optimized result snippets.

Use this feature when the agent needs current public facts, URLs, snippets, or lightweight research leads.

Do not use this feature for authenticated/private pages. Use browser automation or a dedicated platform integration for those.

## User-facing behavior

The user normally does not call the raw tool directly. The LLM can call the `web_search` tool when a prompt needs current information.

Setup command path:

```txt
aurix setup → Web Search Engine
```

Config path:

```txt
~/.aurix/config.yaml
```

Relevant config:

```yaml
searchEngine: ddg      # ddg | searxng | serper | tavily
searchApiKey: ""       # used by serper/tavily
searchBaseUrl: ""      # optional SearXNG instance URL
```

Environment overrides:

```bash
SEARCH_API_KEY=...
TAVILY_API_KEY=...
SEARCH_BASE_URL=https://search.example.com
SEARXNG_URL=https://search.example.com
```

`SEARCH_BASE_URL` and `SEARXNG_URL` are used for SearXNG.

## Source files

Primary files:

- `src/tools/WebSearch.ts`
- `src/agent/Config.ts`
- `src/agent/Setup.ts`
- `src/index.tsx` for registry wiring through `createRegistry()`

Related files:

- `src/tools/Registry.ts` for tool execution.
- `src/agent/Context.ts` for search/tool usage instructions.
- `docs/features/setup-config.md` for setup preservation rules.

## Runtime flow

1. `createRegistry()` registers `webSearchTool`.
2. The model receives `web_search` in its tool definitions.
3. The model calls:

   ```json
   { "query": "latest AI news", "max_results": 5 }
   ```

4. `webSearchTool.execute()` loads config through `loadConfig()`.
5. `searchEngine` decides which backend runs.
6. Results are formatted as text with numbered items, URLs, and snippets.
7. The formatted string returns to the LLM as a tool result.

## Engine behavior

### DuckDuckGo (`ddg`)

Default engine.

Properties:

- No API key.
- Uses DDG Instant Answer API first.
- Falls back to DDG HTML parsing.
- If DDG returns nothing, uses public SearXNG fallback instances.

Use this as the safe default for users who do not want paid APIs.

### SearXNG (`searxng`)

Free metasearch engine.

Properties:

- No API key.
- Can use public fallback instances.
- Can use self-hosted/private instance via `searchBaseUrl`.
- Returns JSON from `/search?q=...&format=json`.

Preferred config for self-hosted:

```yaml
searchEngine: searxng
searchBaseUrl: https://search.example.com
```

If `searchBaseUrl` is empty, Aurix tries built-in public instances.

### Serper (`serper`)

Google-like results through Serper.dev.

Properties:

- Needs API key.
- Uses `https://google.serper.dev/search`.
- Env: `SEARCH_API_KEY`.

If key is missing, the tool returns an instruction telling the user how to set it.

### Tavily (`tavily`)

AI-optimized search API.

Properties:

- Needs API key.
- Uses `https://api.tavily.com/search`.
- Env: `TAVILY_API_KEY` or `SEARCH_API_KEY`.

Use Tavily when result snippets/answer summaries matter more than raw search parity.

## Invariants to preserve

- `ddg` must remain the default.
- The feature must work with no API key.
- Missing Serper/Tavily keys must not crash the agent.
- SearXNG must not require an API key.
- `searchBaseUrl` must not be used for Serper/Tavily.
- Do not put API keys in prompts, logs, docs examples, or test fixtures.
- The tool result should include URLs whenever available.
- Keep `max_results` as a soft cap.
- Use request timeouts so tool calls do not hang a whole agent turn.

## Setup behavior

`runSetup()` should preserve existing search settings when the user skips the Web Search Engine step.

Rules:

- Skip with existing engine keeps existing engine.
- Skip with existing API key keeps that key.
- Selecting `ddg` clears the need for API keys.
- Selecting `searxng` may optionally store `searchBaseUrl`.
- Selecting `serper` or `tavily` asks for an API key.
- If a paid/API engine is selected but no key is entered, fallback should be explicit.

## Common failure modes

### SearXNG public instance blocks JSON

Some public instances disable JSON or rate-limit unknown clients.

Expected behavior:

- Try the next fallback instance.
- If all fail, return a helpful no-results message.

### Wrong `searchBaseUrl`

If the user sets a base URL that does not expose `/search?format=json`, SearXNG returns no results.

Expected behavior:

- Return `No SearXNG results` and mention `searchBaseUrl`.

### Provider key missing

Serper/Tavily may be selected with no key.

Expected behavior:

- Do not throw.
- Return setup instructions.
- Keep the agent turn alive.

### Stale search results

Search engines may return old indexed content.

Expected behavior:

- The LLM should cite/describe sources conservatively.
- For important facts, use browser or multiple searches.

## Verification checklist

Run:

```bash
npx tsc --noEmit
npm run build
```

Manual checks:

```yaml
searchEngine: ddg
```

Ask Aurix for a current topic. Confirm results return without keys.

```yaml
searchEngine: searxng
searchBaseUrl: https://searx.be
```

Ask Aurix for a web query. Confirm SearXNG results are returned.

```yaml
searchEngine: serper
searchApiKey: ""
```

Confirm the tool returns a missing-key message instead of crashing.

```yaml
searchEngine: tavily
searchApiKey: ""
```

Confirm the tool returns a missing-key message instead of crashing.

## Editing guidance for AI agents

Before changing web search:

1. Read `src/tools/WebSearch.ts`.
2. Read `src/agent/Config.ts` search config fields.
3. Read `src/agent/Setup.ts` `stepSearchEngine()`.
4. Check whether the new engine needs an API key, base URL, or both.
5. Add env overrides only if they are obvious and documented.
6. Preserve DDG as the zero-config fallback.
7. Run typecheck and build.

Do not add a paid-only engine as the default.

Do not remove SearXNG/DDG fallback behavior unless replacing it with another free no-key path.
