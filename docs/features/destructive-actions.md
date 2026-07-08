# Feature: Destructive Actions and Recovery

## Purpose

Aurix treats file and folder deletion as a special destructive action. Deletion must go through the built-in tools so the runtime can require human approval, block unsafe terminal commands, preserve a short recovery window, and record observer events.

## User-facing behavior

- `delete_file` and `delete_folder` always require a user deny/allow decision, even when normal tool permissions are in bypass/yolo mode.
- The CLI permission prompt defaults to **Deny** for delete operations and offers only deny/allow.
- Gateway users approve deletes by replying to the deny/allow prompt; Telegram renders inline buttons when available.
- Terminal deletion commands are blocked. Use `delete_file` or `delete_folder` instead of `rm`, `rm -rf`, `rmdir`, `del`, `unlink`, `Remove-Item`, or `find -delete`.
- Approved deletes are moved into `~/.aurix/trash/` instead of being permanently removed immediately.
- Recovery is available for 5 user messages in the same durable session.

## Commands and tools

Tools:

```txt
delete_file
delete_folder
recovery_file
recovery_folder
```

CLI commands:

```txt
/trash
/trash list
/trash recover <id-or-original-path>
```

## Runtime flow

1. The model requests `delete_file` or `delete_folder`.
2. `ToolRegistry` ignores model-provided confirmation flags and always asks the user.
3. If denied, the tool returns a cancellation message and emits a `delete_denied` observer event.
4. If allowed, the tool moves the file/folder into `~/.aurix/trash/<recovery-id>/payload/` and writes a manifest.
5. The tool returns the recovery ID and emits `delete_moved_to_trash`.
6. `recovery_file`, `recovery_folder`, or `/trash recover` can restore it until the 5-user-message window expires.
7. After expiry, `TrashStore` purges expired recoverable trash entries.

## Storage model

Trash entries are file-backed under:

```txt
~/.aurix/trash/
```

Each deletion creates:

```txt
~/.aurix/trash/del_<timestamp>_<random>/manifest.json
~/.aurix/trash/del_<timestamp>_<random>/payload/<original-name>
```

Manifest fields:

```json
{
  "id": "del_20260707123456_abcd1234",
  "type": "file",
  "originalPath": "/project/file.ts",
  "trashPath": "/home/user/.aurix/trash/.../payload/file.ts",
  "sessionId": "sess_xxx",
  "turnId": "turn_xxx",
  "deletedAtUserTurn": 3,
  "expiresAfterUserTurns": 5,
  "createdAt": "2026-07-07T00:00:00.000Z",
  "status": "recoverable"
}
```

A `user-turn-counters.json` file tracks the user-message count per session.

## Source files

- `src/agent/DestructiveActionPolicy.ts` — terminal delete-command detection and mandatory delete approval policy.
- `src/agent/TrashStore.ts` — recoverable trash storage, recovery, and expiry.
- `src/tools/Registry.ts` — forces approval for delete tools even in bypass mode.
- `src/tools/Terminal.ts` — blocks terminal deletion commands.
- `src/tools/FileOps.ts` — delete/recovery tool implementations.
- `src/cli/PermissionPrompt.tsx` — deny-first CLI prompt for deletes.
- `src/cli/App.tsx` — `/trash` command.
- `src/gateway/Gateway.ts` — gateway delete approval prompts.

## Observer events

Destructive action events are published to the observer bus:

- `delete_denied`
- `delete_moved_to_trash`
- `recovery_success`
- `recovery_failed`

These appear in `/replay` and affect `/evals` scoring.

## Invariants to preserve

- Never permanently delete directly from `delete_file` or `delete_folder`.
- Never trust model-provided confirmation arguments.
- Never allow terminal deletion commands to bypass the delete tools.
- Never overwrite an existing path during recovery.
- Default destructive prompts to Deny.
- Keep recovery scoped to the originating durable session unless explicitly designed otherwise.

## Common failure modes

### Model uses terminal `rm`

Expected behavior: terminal returns a blocked-command message instructing the model to use `delete_file` or `delete_folder`.

### User sleeps after delete

Expected behavior: the item remains recoverable until 5 user messages later. It is not based on assistant/tool chatter.

### Original path already exists during recovery

Expected behavior: recovery refuses instead of overwriting.

## Verification checklist

```bash
npx tsc --noEmit
npm run build
```

Manual smoke:

```txt
Ask Aurix to delete a temp file.
Deny the prompt: file remains.
Ask again and allow: file moves to ~/.aurix/trash.
Run /trash: recovery ID appears.
Run /trash recover <id>: file is restored.
Ask Aurix to run rm -rf <temp-dir>: terminal blocks it.
```
