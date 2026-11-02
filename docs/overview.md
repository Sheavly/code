# Overview

## What it is for

In the author's words: "a typescript loop with the possibility of UI in the future that runs a
coding agent and handles everything from tool calls, reading agents.md files, handling sub
agents, background tasks." It works with any model provider, and the loop must "wait for tools,
wait for agent, wait for user, interrupt agent by user."

The harness owns the agent loop and everything it emits; a UI (or the CLI demo) only renders
events. That split decides where new work goes: if a UI would need it, the harness emits it.

**Backend only.** The harness renders nothing, prompts no one and reads no terminal input. What a
user must see or decide is a typed event or a registry request (`AgentEvent`, `SessionUpdate`,
`ApprovalUpdate`) that a UI handles its own way. UI code is written only when an issue asks for a
UI, and only in the front-end files named in `FRONT_END_FILES` (`eslint.config.js`); the shared
`harness/no-terminal-io` rule fails terminal I/O anywhere else, in every workspace. Cursor injects
this rule from the project skill the first time a chat edits harness source.

## Layers

Imports only point down. ESLint enforces it (`LAYERS` in `eslint.config.js`).

```
@sheavly/core  ←  providers, runtime  ←  tools  ←  loop  ←  host  ←  front ends
```

| Where                | What lives there                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/` | Contracts only: `message/`, `provider/`, `tool/`, `adapter/`, `hook/`, `session/`                                                                                                         |
| `src/providers/`     | Model backends: adapter registry, OpenAI / Azure / Astra, Responses client                                                                                                                |
| `src/runtime/`       | Stateful services: workspace path confinement, processes, background tasks, sessions, approvals, file locks, workspace trust, `.sheavly/`, AGENTS.md; the typed error classes (`errors/`) |
| `src/tools/`         | One folder per tool: `read-file`, `write-file`, `edit-file`, `run-command`, `tasks`, `sub-agent`                                                                                          |
| `src/loop/`          | `streamAgent` / `runAgent`, events, the ordered queue, abort helpers, hooks                                                                                                               |
| `src/host/`          | Wiring a run (`createHarness`) and the model from env. No UI, and no imports from a front end                                                                                             |
| `src/terminal-ui/`   | Front end: the terminal `Renderer` the demo and the workbook print events with                                                                                                            |
| `src/demo.ts`        | Front end: a CLI that reads env, wires a run with `createHarness`, prints events                                                                                                          |
| `src/workbook/`      | Front end: a stateful CLI with stored prompts, saved runs, continue, step and diff (`workbook/`)                                                                                          |

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
   A `tool_result` can carry `change` (a file write: before and after) or `read` (which lines a
   read covered); the model sees only the text, a UI renders these.
4. `afterTurn` hooks run. If the model called tools, the next turn starts; otherwise the run ends
   (or waits for a background task, with `waitForTasks`).
5. `done` is always last and carries the full history, valid to continue from, and the run's
   session (every run is a session with an id; see [sessions.md](sessions.md)).

Aborting the signal stops cleanly at any point: unfinished tools get an "interrupted" result, so
history stays valid. If the run fails, `onError` hooks are told and the error is rethrown; an
`onError` handler that fails is reported as a `hook_failed` event, never in place of that error. A
model call that fails after it started tools (a cut-off stream, an error event) first stops those
tools and emits their results, so every `tool_call_started` is answered, then fails the run.

## Trust model

The harness is for **trusted local repositories**. It checks what the agent asks for, but it is
not an OS sandbox: nothing isolates the processes it runs from the rest of the machine. For a repo
you don't trust, run the harness in a container or VM.

What `Workspace` (`src/runtime/workspace/`) and the tools enforce is **path confinement**:

- The file tools resolve every path inside the workspace root and refuse anything that ends up
  outside it (`../`, absolute paths, symlinks out). `.env` files are refused by name, and writes
  inside `.git` are refused ([tools.md](tools.md#file-tools)).
- `run_command` runs only allow-listed commands without shell syntax, checks their arguments with
  the same path rules, asks for approval when one reaches outside or can name a `.env` file, and
  sets git config that blocks most ways a repo can make git run programs
  ([tools.md](tools.md#commands)).
- Commands get the harness's env without the variables whose names look like secrets (`KEY`,
  `SECRET`, `TOKEN`, `PASSWORD`, `CREDENTIAL`). This is a filter on names, not complete scrubbing:
  a secret in a value under another name (`DATABASE_URL`), `SSH_AUTH_SOCK` and credential files
  the user can read (`~/.npmrc`, `~/.aws/credentials`) still reach commands.

What runs with the user's full rights, outside those checks:

- **Allowed commands, and anything they execute.** `npm test` runs the repo's npm scripts, test
  config and test files; those can read, write or send anything the user can. Argument checks
  don't reach inside them. Isolating commands is [#4](https://github.com/Sheavly/code/issues/4).
- **Any command, with `skipAllowList`.** With it set (`RUN_COMMAND_SKIP_ALLOW_LIST=true` in the
  demo), `run_command` runs whatever shell command the model writes, with no allow list, argument
  checks or approvals.
- **Git filter drivers a repo brings.** A filter defined in a cloned repo's `.git/config` and
  named in a committed `.gitattributes` still runs when an allowed `git status` or `git diff`
  does; on git older than 2.42, so does one an edited `.gitattributes` turns on.
- **`.sheavly/` project hooks.** They run inside the harness process, with its rights and its env
  (keys included). They load only in a workspace the user trusted, and only until `.sheavly/`
  changes ([hooks.md](hooks.md#workspace-trust)), but once loaded nothing confines what they do.

## Errors

The harness fails loudly, and ESLint enforces it in every workspace and on `.cursor/hooks/`:

- `harness/no-silent-catch`: a `catch` either rethrows or checks what it caught (an error code, a
  class) and handles only what it expects, so no failure turns silently into a default.
- `harness/no-raw-error`: source never creates a plain `Error`. Every error is a typed class,
  with a `name` and the fields to act on, keeping the original as `cause`, so a caller catches it
  by class instead of by message. Tests, fakes and root `scripts/` are exempt.

Each area keeps its own classes, since the layers can't all import one another:

| Where                            | Classes                                                    |
| -------------------------------- | ---------------------------------------------------------- |
| `packages/core/src/errors/`      | `DefinitionError`: a tool or hook defined wrong            |
| `src/providers/errors/`          | `AdapterError`, `ResponsesApiError`, `ProviderSwitchError` |
| `src/runtime/errors/`            | Runtime, tools, loop and hosts (below)                     |
| `.cursor/hooks/hooks.errors.mjs` | `HookStateError`, `ProjectReadError`, `GuardCrashError`    |

| `src/runtime/errors/` class            | Thrown when                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceError`                       | A path is outside the workspace, or a broken symlink                                                                        |
| `PathCheckError` (`path`, `code`)      | A path couldn't be checked at all (`EACCES`, `ELOOP`); never "missing"                                                      |
| `ProjectHooksError`                    | `.sheavly/` hooks can't be read, validated or loaded                                                                        |
| `ProcessKillError` (`pid`, `code`)     | A command's process group couldn't be stopped; it may still be running                                                      |
| `ProcessInterruptedError`              | The run was interrupted before a command started                                                                            |
| `ApprovalRequestError` (`reason`)      | No one listens for approvals, or an answer names no waiting request                                                         |
| `ApprovalListenerError` (`update`)     | An approval subscriber threw                                                                                                |
| `CommandRefusedError` (`reason`)       | A command needed approval nobody could give, or the user skipped it                                                         |
| `ToolCallError` (`reason`)             | A tool refused a call (`not_found`, `invalid_input`, `forbidden`, `unavailable`); the message tells the model how to fix it |
| `SessionError` (`reason`, `sessionId`) | A session operation was refused (unknown, ended, too deep, not an ancestor)                                                 |
| `AgentsMdError` (`root`, `cwd`)        | The working directory is outside the project root                                                                           |
| `TrustStoreError` (`file`)             | The workspace trust store exists but can't be read, parsed or written                                                       |
| `HookError` (`hook`, `handler`)        | An `onError` handler threw (reported as `hook_failed`)                                                                      |
| `StreamEndedError`                     | A run's event stream ended without `done`                                                                                   |
| `WorkbookStoreError` (`file`)          | A workbook file exists but can't be read or parsed                                                                          |
| `WorkbookNotFoundError` (`wanted`)     | A stored prompt, run or saved conversation isn't there                                                                      |
| `WorkbookPromptError` (`prompt`)       | A stored prompt file has bad front matter                                                                                   |

`errors.utils.ts` has `errorMessage`, `errorCode` and `isMissingPath` (`ENOENT` / `ENOTDIR`
only).

## Where the next work goes

- A contract other packages or a UI depend on: `packages/core/src/<module>/`.
- A model backend: `src/providers/adapters/<name>.adapter.ts`.
- A tool: `src/tools/<name>/` (see [tools.md](tools.md)).
- A new hook point: an optional handler on `Hook` (see [hooks.md](hooks.md)).
- Something a UI must show: a new event in `src/loop/events/events.types.ts`.
