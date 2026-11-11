# @sheavly/protocol

The wire contract: everything the harness sends a UI or accepts from one (`AgentEvent`,
`SessionUpdate`, `StreamEntry`, `ApprovalUpdate`, `ApprovalResponse` and the types inside them), as zod schemas.
Every type is `z.infer` of its schema, so the types and what goes over the wire can't drift. It
depends on zod only.

```ts
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { agentEventSchema } from '@sheavly/protocol/event/event.validator';
```

A client in another language reads `contract.schema.json`, the whole contract as one JSON Schema,
or `openapi.json`, the HTTP API as an OpenAPI 3.2 document. After changing a schema or a route,
run `npm run schema -w @sheavly/protocol`; a test fails while either file is out of date.

Model-first setup uses `GET /setup/models` to return `ModelOffering` choices and supported hosting
routes. Optional `ModelIdentity` metadata keeps the chosen model separate from its profile UUID,
display name and adapter definition. Legacy model files without it remain valid. Catalogue values
belong to the backend app; this package defines and validates only their wire shapes.

| Module               | What it holds                                                                |
| -------------------- | ---------------------------------------------------------------------------- |
| `event/`             | The loop's `AgentEvent`s and the `ToolArtifact` they carry                   |
| `session/`           | `SessionRef`, `SessionInfo`, the `SessionUpdate` stream                      |
| `stream/`            | `StreamEntry`: every session's events and updates, in one order              |
| `approval/`          | `ApprovalRequest`, `ApprovalUpdate`, `ApprovalResponse`                      |
| `task/`              | Background task states                                                       |
| `message/`           | What a model is sent, and the `PromptPart`s a user typed                     |
| `history/`           | `HistoryMessage`: the stored conversation, above message, session and task   |
| `skill/`             | `SkillInfo`: a skill as a UI lists it                                        |
| `server/`            | The server's requests, responses and `ServerError` codes                     |
| `store/`             | `StoredConversation`: a past conversation as the store lists it              |
| `model/`             | A model's id, name and file, `AdapterDescription`, and the `KeyCheck` result |
| `setup/`             | `GET /setup` and the profile, model and credential requests of a setup UI    |
| `id/`                | `lowercaseUuidSchema`: the shape of every id a file or folder is named by    |
| `profile/`           | A profile's identity and model preferences                                   |
| `terminal-settings/` | Global terminal preferences, shared by every profile                         |
| `usage/`             | Reported per-call token usage, recorded cost estimates and cumulative totals |
| `notice/`            | `HarnessNotice`: model and UI data carried by `harness_notice` events        |
| `permission/`        | A folder's command permissions: its mode and the commands the user allowed   |
| `time/`              | `timestampSchema`: when something happened, in milliseconds since the epoch  |
| `api/`               | `API_ROUTES`: every HTTP route's method, path and schemas; `openApiDocument` |
| `contract/`          | `contract.schema.json`, generated from the schemas                           |

Conversation details keep `contextUsage` separate from cumulative `usage`: the latest main-session
measurement (`used`), active window (`window`) and snapshot position (`throughSeq`). Unknown
measurements are omitted so clients cannot confuse missing counts with an empty context.

Before each model call with known context data, a `harness_notice` event carries the same typed
notice the model receives. UIs can display or ignore it through the ordinary stream; the payload
contains no model instructions or UI presentation. Completion notices share `TaskCompletionContext`
(`reason`, `startedAt`, `durationMs`, `userMessagesSinceStart`, optional `callId`). Their `context`
field is optional for old stored histories; new loop-produced completions supply it. `TaskInfo.reason`
is the explicit `await_tasks` reason retained per grouped task, absent on ungrouped and legacy tasks.
`running-tasks` is a transient, nonempty snapshot with at most 10 entries: task ID, title (max 200
characters), agent-authored reason (max 1000 characters), epoch `startedAt`, and optional scalar
`group` (the first requested member ID). `total` equals shown entries plus `omitted`; commands and
output are forbidden. Limits are published in `notice/notice.constants.ts`; inferred types are
`RunningTask` and `RunningTasksNotice`. Persistent history rejects this kind.
See [harness notices](docs/contract.md#harness-notices).

## Docs

New user messages can carry a stable `id`; stream entries carry the originating `messageId`.
Both are optional for older histories. A `run_failed` event reports selected error details,
including a bounded stack and cause chain, before the failed session update. These diagnostics
never enter model history.

- [The wire contract](docs/contract.md): what is in it, what stays out, and how it is checked.
