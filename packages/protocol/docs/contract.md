# The wire contract

What is in the contract, what stays out, and how it is kept honest.

## What is in it

`@sheavly/protocol` is the bottom layer: everything the harness sends a UI or accepts from one
(`AgentEvent`, `SessionUpdate`, `StreamEntry`, `ApprovalUpdate`, `ApprovalResponse` and the types inside them),
defined once as zod schemas. Every type is `z.infer` of its schema, so the TypeScript types and
what goes over the wire can't drift. It depends on zod only; its `eslint.config.js` keeps the
other workspace packages out.

- A TypeScript UI imports the types (`@sheavly/protocol/event/event.types`) and can parse what it
  receives with the schemas (`event.validator`).
- Any other client reads `packages/protocol/contract.schema.json`, the whole contract as one JSON
  Schema (draft 2020-12, every type under `$defs`). `npm run schema -w @sheavly/protocol` writes it
  from the schemas, and a test fails when the committed file is out of date.
- A loop test (`wire-contract.test.ts`) parses every event and session update of a scripted run
  against its schema.
- Ids are branded: `SessionId`, `CallId`, `TaskId` and `ApprovalId` (each `<x>IdSchema`, a
  `z.string().brand<…>()`), so one kind can't be passed where another goes. The brand is
  type-only, so on the wire and in `contract.schema.json` each is a plain string, named under
  `$defs`. A value gets its brand by being parsed (a TypeScript UI parses what it receives, or
  `sessionIdSchema.parse(id)`), never by `as` (`harness/branded-ids`, `harness/no-brand-cast`).
- An event inside a `StreamEntry` is an `EntryEvent`: the same as an `AgentEvent`, except that
  its `done` has no `messages`. The combined stream is kept for replay, so the history isn't in
  it; a UI reads the history on its own.
- Only the wire contract lives there. What a provider streams (`StreamEvent`, `StopReason`) and
  the code contracts (`Tool`, `Hook`, `Adapter`) stay in `@sheavly/core`, and the queue's generic
  `Sequenced<T>` in the loop.

## What a server accepts and answers

`server/` holds the requests and responses of the harness server (`@sheavly/server`), so the
server validates with the same schemas a client imports:

| Request                                       | Body                                   | Answer                             |
| --------------------------------------------- | -------------------------------------- | ---------------------------------- |
| `GET /conversations`                          | none                                   | `ConversationsResponse`            |
| `POST /conversations`                         | `StartConversationRequest`             | `StartConversationResponse`        |
| `GET /conversations/:id`                      | none                                   | `ConversationDetails`              |
| `PUT /conversations/:id/model`                | `SwitchModelRequest`                   | nothing (`204`)                    |
| `POST /conversations/:id/prompts`             | `SendPromptRequest`: `text` or `parts` | that prompt's `StreamEntry`s (SSE) |
| `QUERY /conversations/:id/stream`             | `StreamQuery`, and `Last-Event-ID`     | `StreamEntry`s (SSE)               |
| `POST /conversations/:id/approvals/:approval` | `AnswerApprovalRequest`                | nothing (`204`)                    |
| `POST /conversations/:id/stop`                | none                                   | nothing (`204`)                    |
| `DELETE /conversations/:id`                   | none                                   | nothing (`204`)                    |
| `GET /conversations/:id/messages`             | none                                   | `MessagesResponse`                 |
| `QUERY /conversations/:id/skills`             | `SkillsQuery`                          | `SkillsResponse`                   |

- A prompt is `text`, as a script types it (`/<name>` mentions in it run those skills), or
  `parts`, as a UI builds it (exactly the skills picked run). Not both.
- A user message keeps `content`, what the model saw (with a skill's instructions), and `parts`,
  what the user typed, for a UI to show the skills as chips. Providers send only `content`.
- Every failure is a `ServerError`: `{ error: { code, message } }`, where `code` is one of
  `ServerErrorCode`.
