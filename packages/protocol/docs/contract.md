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

Model-first setup uses `GET /setup/models` (`ModelCatalogResponse`): backend-provided model
identities and their supported hosting routes, with editable defaults and fixed native-model
fields. The model contract accepts optional `identity: { model, family? }` independently of the
profile UUID, adapter definition and credential. Models without that metadata remain valid.
The protocol defines shapes, not a model catalogue or a choice of provider for a run.

`server/` holds the requests and responses of the harness's HTTP API (the backend's routes, and
`@sheavly/client`'s client for them), so both validate with the same schemas; `api/` lists the
routes themselves (`API_ROUTES`), each with its method, path and these schemas:

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

## Approval permissions

`ApprovalRequest.options` names the decisions a UI may offer. When it includes `allow_session` or `always_allow`,
the optional `keeps` array carries the exact allow-list entries the choice would save, such as
`touch *`, `git diff *`, `npm run test *` or `npx eslint *`. Each entry uses `allowEntrySchema`. A UI displays those
entries rather than guessing their scope from `command`; requests without `keeps` remain valid.
`{ decision: 'allow_session' }` grants those entries for the current conversation without persistence;
`{ decision: 'always_allow' }` saves them for the workspace. The caller owns applying the grant;
the registry refuses decisions that were not offered. A grant covers every option, path and
other argument of its base command, including secret files, outside-workspace access, editing,
execution overrides and npx downloads. Built-in approvals follow the same rule. Different base
commands in a chain are checked independently. `always_ask` ignores every grant.

Older path-specific entries, `read:`, `tool:` and `script:` scopes, and `exact:` JSON argument
arrays remain readable for compatibility, but their effective scope is now their base command.
For example, `read:sed *` grants `sed *` and `tool:npx eslint check *` grants `npx eslint *`.
The stored strings need not be rewritten. A JSON array can still preserve a command identity
such as an npm script name containing spaces; it does not impose exact argument matching.

## Run limits

`turn_end.stopReason` distinguishes `max_tokens` (output, including thinking) from
`context_window_exceeded` (the conversation no longer fits). A bounded output recovery emits
`output_continuation` with `attempt` and `maxAttempts`. A run that cannot finish because of either
limit ends with that reason in `done`, session state and `lastOutcome`, never `completed`.

## Models

`ModelMode` is `low`, `medium`, `high` or `extreme`. `ModelSelection` pairs `modelId` with `mode`.
A profile keeps `lastModelSelection` and `modelModes`, keyed by model UUID; absent per-model
preferences start on medium. `PUT /conversations/:id/model` accepts optional `mode`: supplying it
sets and remembers effort for that model; omitting it restores that model's last-used effort.
The active model choice, session updates and stored conversation index carry the mode too.
Modes do not change context size, tool permissions or the output-token limit.

`model/` is how a model is described to a UI and stored, with no code that talks to a provider:

- A model has an **id**, a lowercase UUID that is the stem of its file (`models/<id>.json`) and
  what a request, a credential and the model switch call it by. A UUID can't name another path, so
  nothing else is accepted as a file name, and the file's own `id` must be its name: a copy or a
  rename by hand is refused, not served under another id.
- It has a **name** for people (`Astra 6`), free text, required because the file name says nothing.
  It is only a label: it is never sent to a provider and nothing is keyed by it, so two models can
  share one, and a UI shows whatever it likes. A model is picked, switched to and stored (a
  conversation's `modelId`) by its id on every route and in every file; where a person types a
  name, the client finds the model by it and sends the id, and asks which when it finds two.
- What the **provider calls the model** is a different thing, one of the adapter's own fields
  (`model` for OpenAI, `deployment` for Azure). `AdapterDescription.remoteField` says which, for an
  adapter that has one, so a UI can show both ("Astra 6", gpt-5) without knowing each adapter's
  vocabulary.
- A model's file (`ModelFile`) is `{ id, name, adapter, ...the adapter's own fields }`: flat, so it
  reads and edits by hand, and complete, so it says what it is whatever it is called. `toModel`
  reads it once into a `Model` (`id`, `name`, `adapter`, `definition`), and `toModelFile` writes
  one back. The file never holds a secret: a key lives with the profile's credentials.
- A model may also carry an optional `contextWindow`, in the envelope like `pricing`: how large a
  context the agent is told it has, so a person can choose it for cost. It is one of
  `CONTEXT_WINDOW_SIZES`, 300,000 or 1,000,000 tokens (`CONTEXT_WINDOW_LABELS`: "300K" and "1M"), a
  rounded size and not any provider's exact window; any other value is refused. A model that sets
  none is told `DEFAULT_CONTEXT_WINDOW` (300K). The setting only says what the agent is told: it
  doesn't limit what the provider accepts. A `usage` event repeats the window its call ran against
  (`ModelUsage.contextWindow`, any positive size), so a UI can show usage against it without
  looking the model up.
- `AdapterDescription` is what `GET /adapters` says about an adapter: its kind, a description,
  the fields a model of it takes as JSON Schema (a field a person must keep secret carries
  `secret: true`), and the names of the secret fields. A UI builds its form from it, and needs no
  provider code to do so.
- `KeyCheck` is how a check of a model's key ended: `valid`, or `invalid` (the key was refused),
  `not_found` (the endpoint or deployment doesn't exist), `rejected` (the provider answered but
  refused the request) or `unreachable`, with a fixed message, never the provider's own text, so a
  key can't come back in it.
