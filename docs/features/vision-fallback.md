# Feature: Vision Fallback

## Purpose

Vision Fallback lets Aurix process images even when the main chat model does not support vision.

The core idea:

1. Detect image attachments in the conversation.
2. Send the image to a configured vision-capable provider/model.
3. Convert the image into a detailed text description.
4. Remove the image from the main message.
5. Let the main model continue with text-only context.

This supports:

- Screenshots from browser automation.
- User-attached images from CLI/gateway.
- Verification widgets and image-based tasks.
- Non-vision main models using a separate vision model.

## User-facing commands

CLI:

```txt
/vision
/vision status
/vision test
```

`/vision` opens the Vision Fallback modal.

`/vision status` prints active provider/model/base URL settings.

`/vision test` sends a tiny test image to the configured vision provider.

## Config

Stored in:

```txt
~/.aurix/config.yaml
```

Fields:

```yaml
visionProvider: custom       # openai | anthropic | custom | custom-anthropic
visionApiStyle: openai       # openai | anthropic | auto
visionBaseUrl: http://127.0.0.1:20128/v1
visionApiKey: sk-...
visionModel: gpt-4o-mini
```

Fallback behavior:

- If `visionProvider` is empty, use main `provider`.
- If `visionBaseUrl` is empty, use main `baseUrl`.
- If `visionApiKey` is empty, use main `apiKey`.
- If `visionApiStyle` is empty, use main `apiStyle`.
- If `visionModel` is empty, default to `gpt-4o` for generic image fallback.

## Source files

Primary files:

- `src/agent/AgentLoop.ts`
- `src/cli/VisionModal.tsx`
- `src/cli/App.tsx`
- `src/agent/Config.ts`
- `src/providers/index.ts`
- `src/tools/captcha/common.ts`

Related files:

- `src/tools/Browser.ts`
- `src/tools/captcha/RecaptchaSolver.ts`
- `src/tools/captcha/FuncaptchaSolver.ts`

## Runtime flow: generic images

1. `AgentLoop.run()` receives a user message with `images`.
2. Before the main provider call, it scans recent messages.
3. If a message has images and no `[Vision Analysis:]`, the loop creates a vision provider config.
4. It calls `createProvider()` with vision config.
5. It asks the vision model to describe visible UI, buttons, fields, and important text.
6. It appends `[Vision Analysis: ...]` to message content.
7. It clears `m.images` so the main model receives text only.
8. Main provider continues as normal.

## Runtime flow: captcha/verification images

The captcha stack uses `visionClassify(imageBase64, prompt)` from `src/tools/captcha/common.ts`.

That function:

1. Loads config.
2. Builds a provider from vision config.
3. Wraps the base64 image as a `data:image/png;base64,...` URL.
4. Calls provider chat with the prompt and image.
5. Uses a timeout so classification does not hang forever.

This path must use the same provider abstraction as generic vision fallback. Do not hardcode `/chat/completions` unless you also support Anthropic-compatible endpoints.

## Provider behavior

`createProvider()` supports:

- `openai`
- `anthropic`
- `custom`
- `custom-anthropic`

`custom` honors `apiStyle`:

- `openai` → OpenAI-compatible requests.
- `anthropic` → Anthropic-compatible requests.
- `auto` → auto-detection.

`custom-anthropic` should force Anthropic provider behavior.

## Invariants to preserve

- Main model should not see raw images after fallback analysis.
- Vision fallback must not require the main model to be vision-capable.
- Captcha/verification vision must use the same config path as generic vision.
- Data URLs must be accepted in provider image handling.
- A failed vision call should not crash the whole agent turn.
- A failed vision call should append `[Vision Analysis Failed: ...]` and continue.
- `visionApiKey` should never be displayed in full.
- `/vision test` should be safe and tiny.

## Common failure modes

### Provider mismatch

Symptom:

- Vision test fails with endpoint errors.

Cause:

- `visionProvider` is `anthropic` but URL is OpenAI-compatible, or reverse.

Fix:

- For OpenAI-compatible local routers use:

```yaml
visionProvider: custom
visionApiStyle: openai
```

- For Anthropic-compatible routers use:

```yaml
visionProvider: custom-anthropic
visionApiStyle: anthropic
```

### Captcha vision uses wrong endpoint

Symptom:

- Generic image fallback works but captcha image classification fails.

Cause:

- Captcha path bypassed `createProvider()`.

Fix:

- Ensure `visionClassify()` uses provider abstraction.

### Main model still receives images

Symptom:

- Non-vision main model errors on image content.

Cause:

- `m.images` was not cleared after fallback.

Fix:

- Append analysis text, then clear image array.

## Verification checklist

Run:

```bash
npx tsc --noEmit
npm run build
```

Manual config check:

```txt
/vision status
```

Manual provider check:

```txt
/vision test
```

Manual non-vision check:

1. Configure a non-vision main model.
2. Configure a vision fallback model.
3. Send an image.
4. Confirm the response uses text from the image.
5. Confirm no main provider image error appears.

## Editing guidance for AI agents

Before editing vision fallback:

1. Read `AgentLoop.ts` around the vision fallback logic.
2. Read `providers/index.ts` image serialization.
3. Read `captcha/common.ts` `visionClassify()`.
4. Read `VisionModal.tsx` and `/vision` handling in `App.tsx`.
5. Preserve both generic image and captcha image behavior.
6. Run `/vision test` manually if possible.

Do not assume the main provider and vision provider are the same.
