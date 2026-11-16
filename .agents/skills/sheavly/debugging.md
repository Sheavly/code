# Debugging a run

Start from what the run stored. Everything a conversation did is on disk, so read it before guessing.

## Where the data lives

`~/.sheavly`, or `$SHEAVLY_HOME` when set:

```
~/.sheavly/
  config.json                    the default profile and which profile a workspace uses
  trusted-workspaces.json        workspaces whose `.sheavly/` code may run (fingerprints)
  permissions/<workspace-key>.json   SENSITIVE: command approvals, shared across a repo's worktrees
  recovery/                      by-hand repair material, not written by the harness
  profiles/<profile-id>/
    models/<model-id>.json       a model's non-secret settings
    credentials.json             SECRET: never read, print or paste it
    workspaces/<workspace-key>/conversations/<conversation-id>/
      index.json                 id, title, modelId, mode, workspace, profile, status, startedAt, updatedAt
      stream.jsonl               every entry of the combined stream, in order
      history.jsonl              the model's history, per session
      errors.jsonl               failed tool calls, hooks and runs, derived from the stream
      queue.json                 { queued: [...] } lines typed while a prompt ran
      shell.json                 the conversation's working root
      agents/                    sub-agent histories
      outputs/                   captured command output
```

The workspace key is a hash of the workspace path, so find a conversation by searching `index.json` for the title or the workspace instead of computing it.

Elsewhere: `workbook/runs/<id>/` (a workbook run: its prompt, events, `transcript.txt`, `result.json`; a run without `result.json` did not finish), `MODEL_CALLS_FILE` (opt-in log of model requests: SENSITIVE, it holds prompts and may hold more; read it by field, never print it whole), and `~/.cache/sheavly-harness/chats/<chat-id>.json` (the dev hooks' per-chat state: files edited, hints shown).

## Reading a conversation

Each line of `stream.jsonl` is `{ seq, sessionId, kind, at }` plus `event` (for `kind: 'event'`, an `AgentEvent` with a `type`) or `update` (a session, task or approval update). `seq` is contiguous; a gap or a missing `done` is the first thing to look for. `history.jsonl` lines are `{ seq, entry }`. `errors.jsonl` lines carry `type` (`tool_failed`, `run_failed`, `hook_failed`), `error`, `toolName` and `toolCallId`.

```bash
C=~/.sheavly/profiles/<profile>/workspaces/<key>/conversations/<id>
jq -c '{seq, sessionId, kind, type: (.event.type // .update.type)}' $C/stream.jsonl | head -50
jq -c 'select(.kind=="event" and .event.type=="done") | .event' $C/stream.jsonl
jq -c 'select(.kind=="event" and .event.type=="run_failed")' $C/stream.jsonl
jq -c '{type, toolName, error}' $C/errors.jsonl
jq -c '.queued' $C/queue.json
```

Stored streams, histories and `outputs/` hold whatever the model and the tools saw, which can include secrets: project the fields you need with `jq` as above, and never paste whole entries into a chat or issue.

The field names under `.event` and `.update` are those of the protocol schemas (`packages/protocol/src/event/event.validator.ts`, `packages/protocol/src/session/`, `packages/protocol/src/task/`); read the schema before relying on a field. These recipes use only the keys listed above.

## What to look for

| Symptom                           | Look at                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| the run "hangs"                   | the last `run_state` and `task_*` entries: a finite task still running holds a run open   |
| a sub-agent never reported        | its session updates in `stream.jsonl` and its history under `agents/`                     |
| no `done` at the end              | `run_failed` and the final session update: a failed run may end without a `done`          |
| a tool failed                     | `errors.jsonl` entry, then the `tool_result` with the same `toolCallId` in `stream.jsonl` |
| the model forgot something        | `history.jsonl`: was it summarised? A checkpoint is a `summary` entry                     |
| a hook or AGENTS.md did not apply | `context_added` events and `hook_failed` entries; the working root in `shell.json`        |
| a queued line did not run         | `queue.json`: reopening a conversation shows queued lines and runs none of them           |
| approvals                         | `approval` entries in the stream and `permissions/<key>.json`                             |

## Running and observing the backend

- `npm run serve -w @sheavly/backend` starts the backend. It prints the token if `SERVER_TOKEN` is unset (a secret: never paste it into a chat or issue; set `SERVER_TOKEN` yourself to avoid printing one) and `→ listening on <url>` last. Its settings are env vars: `SERVER_HOST`, `SERVER_PORT`, `SERVER_TOKEN`, `WORKSPACE_ROOT`, `MAX_TURNS`, `SUMMARY`, `CONTEXT_WINDOW`, `MODEL_CALLS_FILE`, `SHOW_MODEL_CALLS` (prints prompts to the terminal), `MODEL_RESPONSE_TIMEOUT_MS`, `MODEL_RETRIES`, `MODEL_RETRY_DELAY_MS`, `SHEAVLY_HOME`, `SHEAVLY_TRUST_FILE`.
- The API is documented in `apps/backend/docs/api.md` and its schema in `packages/protocol/openapi.json`; call it with the bearer token. The backend keeps no log of its own: API errors go to stderr, and a run's failures land in `errors.jsonl`.
- The terminal app connects with `BACKEND_URL` and `BACKEND_TOKEN`, or starts its own backend. `SESSIONS_SSE_LOG` writes the raw stream it received.
- `npm run workbook -- list|show|step|diff` reads stored workbook runs without a model call. `npm run demo` and `npm run workbook -- check` call a paid model: run them only on purpose.

## Debugging the dev tooling

- A hook message that names a skill or guide is routed by `.agents/skills/*/harness.json`; if a guide is missing, `npm run layout` says which.
- A stop-gate failure is recomputed from disk each round; the rounds are Cursor's `loop_limit` in `.cursor/hooks.json`.
- Per-chat hook state is `~/.cache/sheavly-harness/chats/<chat-id>.json`; deleting a corrupt one resets that chat's hints and recorded edits.

## Rules

- Never open or print `credentials.json` or `.env*` files, and never put the server token, anything under `permissions/` or a whole `MODEL_CALLS_FILE` into a chat or issue. Read stored conversations by field with `jq`, as above, not whole. Lint (`harness/no-credentials-file`, `harness/guard-env-read`) stops code and the file tools from reading them; nothing stops a shell `cat`, so this is a rule you follow, not one that is checked.
- Read stored data; don't edit it to "fix" a conversation. The `recovery/` material was made by hand.
- If you need a field this guide doesn't list, read the schema, then add it here.
