# Feature: Setup and Config

## Purpose

Setup and Config control how Aurix stores provider credentials, model settings, gateway tokens, feature flags, browser/search options, vision fallback, and other runtime preferences.

The setup wizard must be safe to run repeatedly.

A rerun of `aurix setup` should help the user update config, not silently erase existing settings.

## User-facing commands

Terminal:

```bash
aurix setup
aurix setup --continue
```

In-app commands:

```txt
/login
/baseurl
/provider
/apikey
/key
/vision
```

Config file:

```txt
~/.aurix/config.yaml
```

## Source files

Primary files:

- `src/agent/Config.ts`
- `src/agent/Setup.ts`
- `src/cli/SetupUI.ts`
- `src/cli/App.tsx`
- `src/index.tsx`

Related files:

- `src/providers/index.ts`
- `src/gateway/Gateway.ts`
- `src/tools/WebSearch.ts`
- `src/cli/VisionModal.tsx`

## Config schema

Core fields:

```yaml
provider: custom
apiKey: sk-...
baseUrl: http://127.0.0.1:20128/v1
model: some-model
apiStyle: openai
maxTokens: 4096
temperature: 0.7
researchMode: low
```

Vision fields:

```yaml
visionProvider: custom
visionApiStyle: openai
visionBaseUrl: http://127.0.0.1:20128/v1
visionApiKey: sk-...
visionModel: gpt-4o-mini
```

Search fields:

```yaml
searchEngine: searxng
searchApiKey: ""
searchBaseUrl: https://search.example.com
```

Gateway fields:

```yaml
gateway:
  telegram:
    enabled: true
    token: "..."
    allowedUsers: []
  discord:
    enabled: true
    token: "..."
  whatsapp:
    enabled: true
```

Other fields:

```yaml
features: []
integrations: {}
plugins: {}
browser:
  proxies: []
tools:
  enabled: []
  disabled: []
```

## Environment overrides

Core provider:

```bash
AURIX_PROVIDER=custom
AURIX_API_KEY=...
AURIX_BASE_URL=http://127.0.0.1:20128/v1
AURIX_MODEL=...
AURIX_API_STYLE=openai
```

Vision:

```bash
AURIX_VISION_PROVIDER=custom
AURIX_VISION_API_KEY=...
AURIX_VISION_BASE_URL=...
AURIX_VISION_MODEL=...
AURIX_VISION_API_STYLE=openai
```

Search:

```bash
SEARCH_API_KEY=...
SEARCH_BASE_URL=...
SEARXNG_URL=...
```

## Runtime flow

1. `src/index.tsx` calls `loadConfig()`.
2. If no API key and not resuming, setup runs.
3. `runSetup()` renders the setup wizard through `SetupUI`.
4. Setup reads existing config first.
5. Each step either updates a field or preserves the existing field on skip.
6. Final config is written through `saveConfig()`.
7. The app starts with the returned config.

## Preservation rules

Setup reruns must preserve existing config unless the user explicitly changes that setting.

Preserve on skip:

- theme
- provider
- API key
- base URL
- model
- gateway tokens
- integrations
- plugins
- features
- captcha mode
- Groq key
- search engine
- search API key
- search base URL
- vision fallback fields
- tool enable/disable lists
- browser proxy config

The config object should start from `existingConfig` and override selected values.

## Provider-change rules

Changing providers is special.

If the user changes provider:

- Do not silently reuse the previous provider API key.
- Ask for a new API key.
- Do not carry an incompatible custom base URL into an official provider.
- Derive the correct `apiStyle`.

Provider mapping:

```txt
openai            → provider=openai, apiStyle=undefined/auto
anthropic         → provider=anthropic, apiStyle=undefined/auto
custom-openai     → provider=custom, apiStyle=openai
custom-anthropic  → provider=custom, apiStyle=anthropic
custom-auto       → provider=custom, apiStyle=auto
```

Do not confuse setup provider labels with runtime provider values.

## SetupUI behavior

`SetupUI.ts` provides:

- `drawInputScreen()`
- `drawSelector()`
- `drawConfirm()`
- `drawBox()`
- `drawInfo()`
- `drawWarning()`
- `drawSuccess()`

Important behavior:

- Escape returns `__back__`.
- Skip returns `__skip__` for single selectors.
- Multi-select skip returns an empty array.
- Masked inputs should not reveal secrets.
- Bracketed paste is handled for keys/tokens.

## Invariants to preserve

- Never print full API keys after input.
- Never erase existing config on skip.
- Never carry old credentials across provider changes without user confirmation.
- Always save config through `saveConfig()`.
- Keep config YAML readable.
- Keep env overrides in `loadConfig()`.
- Setup should work in plain terminal mode, before OpenTUI starts.

## Common failure modes

### API key disappears

Cause:

- Setup created a fresh config without spreading existing config.

Fix:

- Start final config with `...existingConfig`.

### Wrong key used for provider

Cause:

- Existing API key was reused after provider change.

Fix:

- Detect provider change and require a new key.

### Custom base URL leaks into official provider

Cause:

- Existing `baseUrl` was kept when user selected `openai` or `anthropic`.

Fix:

- Reset `baseUrl` on provider change unless the new provider is custom.

### Optional steps erase config

Cause:

- Multi-select skip returns `[]` and code interpreted it as intentional empty config.

Fix:

- If the user skips and existing config exists, keep existing config.

## Verification checklist

Run:

```bash
npx tsc --noEmit
npm run build
```

Manual smoke:

1. Create config with provider, key, model, vision fields, search fields, gateway fields.
2. Run `aurix setup`.
3. Skip optional steps.
4. Confirm fields are preserved.
5. Change provider.
6. Confirm setup asks for API key.
7. Confirm old custom base URL does not leak into official provider.

## Editing guidance for AI agents

Before editing setup:

1. Read `Config.ts` first.
2. Read `Setup.ts` fully.
3. Read `SetupUI.ts` input/selector return values.
4. Identify whether the change affects a config field.
5. Add preservation logic for reruns.
6. Add env override if the field should be scriptable.
7. Run typecheck and build.

Do not add setup prompts that overwrite config on skip.
