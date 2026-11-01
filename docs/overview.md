# Overview

## What it is for

In the author's words: "a typescript loop with the possibility of UI in the future that runs a
coding agent and handles everything from tool calls, reading agents.md files, handling sub
agents, background tasks." It works with any model provider, and the loop must "wait for tools,
wait for agent, wait for user, interrupt agent by user."

The harness owns the agent loop and everything it emits; a UI (or the CLI demo) only renders
events. That split decides where new work goes: if a UI would need it, the harness emits it.

## Layers

Imports only point down. ESLint enforces it (`LAYERS` in `eslint.config.js`).

```
@sheavly/core  ←  providers, runtime  ←  tools  ←  loop  ←  hosts (src/demo.ts)
```

| Where                | What lives there                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/core/src/` | Contracts only: `message/`, `provider/`, `tool/`, `adapter/`, `hook/`, `session/`                   |
| `src/providers/`     | Model backends: adapter registry, OpenAI / Azure / Astra, Responses client                          |
| `src/runtime/`       | Stateful services: workspace sandbox, processes, background tasks, sessions, `.sheavly/`, AGENTS.md |
| `src/tools/`         | One folder per tool: `read-file`, `write-file`, `edit-file`, `run-command`, `tasks`, `sub-agent`    |
| `src/loop/`          | `streamAgent` / `runAgent`, events, the ordered queue, abort helpers, hooks                         |
| `src/demo.ts`        | A CLI host: reads env, wires everything up, prints events                                           |

Every file is `<name>.<kind>.ts` (`types`, `constants`, `utils`, `service`, `tool`, ...); see
the project skill in `.cursor/skills/working-in-sheavly-harness/` for the full conventions.

## The provider contract

A provider (`packages/core/src/provider/`) is one method, `stream(request)`, returning
`StreamEvent`s. Every model call gets a fresh `ProviderRequest`:

| Field          | What it is                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions` | System instructions for this call, or none: the run's `instructions` option, then what `beforeTurn` hooks added (e.g. AGENTS.md), joined with blank lines |
| `messages`     | The conversation history (a copy): user, assistant and tool messages                                                                                      |
| `tools`        | The tool definitions (name, description, JSON schema)                                                                                                     |
| `signal`       | Aborts the call                                                                                                                                           |

`instructions` are rebuilt each turn and never stored in `messages`, so they can change between
turns (an edited AGENTS.md) without touching history. The Responses client sends them as the
API's `instructions` field.

## One run

`streamAgent(options)` returns an async iterable of events, each with a gap-free `seq`:

1. `sessionStart` hooks run (they may add context).
2. Each turn: finished background tasks are reported, messages sent to the session meanwhile
   (steering) are added, `beforeTurn` hooks run (they may add
   context and this turn's system instructions), then the model is called. Text and reasoning
   stream out as they arrive.
3. Tool calls start the moment the model asks for them, each wrapped by `aroundToolCall` hooks.
   Their results are released after the turn ends, in call order (`tool_batch`, `tool_result`).
4. `afterTurn` hooks run. If the model called tools, the next turn starts; otherwise the run ends
   (or waits for a background task, with `waitForTasks`).
   A `tool_result` can carry `change` (a file write: before and after) or `read` (which lines a
   read covered); the model sees only the text, a UI renders these.
5. `done` is always last and carries the full history, valid to continue from, and the run's
   session (every run is a session with an id; see [sessions.md](sessions.md)).

Aborting the signal stops cleanly at any point: unfinished tools get an "interrupted" result, so
history stays valid. If the run fails, `onError` hooks are told and the error is rethrown.

## Where the next work goes

- A contract other packages or a UI depend on: `packages/core/src/<module>/`.
- A model backend: `src/providers/adapters/<name>.adapter.ts`.
- A tool: `src/tools/<name>/` (see [tools.md](tools.md)).
- A new hook point: an optional handler on `Hook` (see [hooks.md](hooks.md)).
- Something a UI must show: a new event in `src/loop/events/events.types.ts`.
