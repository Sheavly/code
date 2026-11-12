# Layers, where code goes, and what a UI decides

## Layers (imports only point down)

What each workspace may import is [the graph](../../../docs/overview.md#layers), generated from the workspaces' `package.json` (`npm run graph`; the layout check fails when it is stale). Never draw a copy of it: a doc links to it.

| Layer                | Holds                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol`  | `@sheavly/protocol`: the wire contract (events, updates, answers) as zod schemas                                                    |
| `packages/core`      | `@sheavly/core`: code contracts, `defineTool`/`runTool`, `defineAdapter`                                                            |
| `packages/providers` | `@sheavly/providers`: protocol layers, backends, registry, switch                                                                   |
| `packages/runtime`   | `@sheavly/runtime`: the generic services, sessions, tasks, approvals                                                                |
| `packages/workspace` | `@sheavly/workspace` (coding): workspace confinement, processes, trust, file locks, `.sheavly/`, AGENTS.md                          |
| `packages/tools`     | `@sheavly/tools`: the generic tools, sub-agents and tasks                                                                           |
| `packages/loop`      | `@sheavly/loop`: `streamAgent` / `runAgent`, events, queue, abort, hooks                                                            |
| `packages/host`      | `@sheavly/host`: `createHarness`, the registries a run shares around the provider a UI picked. No tools, settings or UI             |
| `packages/coding`    | `@sheavly/coding` (coding): the file tools, `run_command`, `createCodingHarness` (the workspace, file locks and process runner)     |
| `apps/*`             | The front ends: `apps/terminal` (the demo, the workbook and the `Renderer` they share); `apps/vscode` is a README until it is built |

ESLint enforces this (`harness/imports`). The layout is read from the workspaces: kind from the folder (`packages/*`, `apps/*`), the graph from each `package.json`'s dependencies, the domain from its `sheavly.domain`; only `NOT_SOURCE` is written by hand, in `packages/eslint-config/src/layout.js`. A workspace without a domain fails `harness/layout`. If an import is rejected, pass the dependency in as an option instead of moving the rule.

## Where code goes

Decide where something lives before writing it. Which workspaces exist and what each is for is the `sheavly-packages` skill (`.agents/skills/sheavly-packages/SKILL.md`), generated from them; read the chosen one's README before adding to it. To choose:

1. **Would a non-coding LLM project (a text extractor, a chat wrapper) need this?** Yes: it is generic, and goes in a generic package, where it knows nothing about files, workspaces or code. No: it is coding, and only coding packages and coding UIs reach it.
2. **Is it a choice about a run** (settings, which provider, which tools and hooks), or anything that reads the terminal, prints or reads env? Then it is an app's: `apps/<name>`.
3. **Otherwise it is a piece**, in the package that owns its concern: a wire type in the protocol package, a contract in core, a service in runtime, a tool in the tools or coding package, a fake in the testing package or the faked package's `src/testing/`, a lint rule in eslint-config. Its README says what it owns.

**A new package, instead of a folder in an existing one**, when all of these hold: it has its own reason to change (not just more of what a package already does); something that shouldn't get the rest of an existing package needs it (a generic consumer, or a UI that needs only the wire contract); and its dependencies point down the graph. Otherwise it is a module folder in the package that owns the concern. Create a package or app with `npm run new` (see [packages.md](packages.md)), never by hand.

## Backend only: typed events, no UI

- The harness is a backend for UIs built on top of it. It emits typed events (loop `AgentEvent`s, `SessionUpdate`, `ApprovalUpdate`) and exposes registries a UI answers through (`approvals.respond`, `sessions.send`). It renders nothing, prompts no one and reads no terminal input.
- Something a user must see or decide is a typed event or a registry request, never a print or a prompt inside the harness. The UI subscribes and handles it its own way.
- Run state useful to downstream UIs is structured protocol data, not assistant prose or provider-specific output. Model-facing notices share the protocol's `HarnessNotice` schema with `harness_notice` events; model instructions stay in the formatter, and presentation stays in apps. A notice kind has a lifetime: transient ones (`context-usage`) ride one model call and are never stored, persistent ones (`agent-report`, `task-finished`) are stored in history as a `notice` entry (`@sheavly/protocol/history/`) for facts the model must remember. Tests must check shared payloads, ordered stream delivery and history isolation, so a new notice kind cannot become a model-only path.
- The `<harness-notice` envelope is written only by `formatHarnessNotice`. `harness/no-handwritten-notice` rejects a string or template piece that holds the tag name (a path or label of that name too) or the start of an opening or closing tag; it cannot see a tag split inside a word or built from a variable, so the formatter's escaping and its tests carry the rest.
- Write UI code only when the chat's issue asks for a UI. Front ends are the apps (`apps/*`): `baseConfig` reads that from where a workspace is, so only an app's source may do terminal I/O, print or read env. A package never reads env, not even for one file: it takes the values, or an `Environment` (`@sheavly/core/environment/environment.types`), as options, and the app passes `process.env` in (`new Profiles({ env: process.env })`, `trustStoreFor(process.env)`, `createCodingHarness({ env })`). The coverage test checks every package source file. `harness/no-terminal-io` fails terminal I/O (`node:readline`, `node:tty`, `process.stdin/stdout/stderr`) in every package; the terminal app's renderer writes through a function its entry points give it.
- `@sheavly/host` wires a run and holds no UI; nothing below the apps imports a front end.
- The library runs in-process, without a server: a UI embeds it (local tools, a remote model through its provider). The HTTP API is the backend app's (`apps/backend/src/api/`), one handler per route of `API_ROUTES` (`@sheavly/protocol/api/`); a UI in another process calls it with `@sheavly/client`'s client, built from the same table. That client is a transport, marked `sheavly.transport`, so only an app depends on it (the layout check). The API adds no behaviour: it turns requests into calls on what `@sheavly/host` serves, so in-process and remote UIs get the same.

## The UI decides what a run includes

- The packages provide pieces and the services a run shares; a UI picks the provider and composes the tools and hooks. No package picks a backend, a model, a tool or a hook for a run, and none reads settings. Enforced: `harness/imports` fails a package's source that imports a `*.tool` module other than from a tool (only apps and tests put tools together), and the layout check fails a package that depends at runtime on one holding model backends (`*.adapter.ts`).
- Concrete implementations inside an otherwise generic package live in dedicated module folders
  marked by its `sheavly.appOnlyModules` array. For example, select Tavily in an app from
  `@sheavly/tools/web-search-backends/tavily-search.helper` and inject it into the provider-neutral
  search tool. `harness/imports` rejects package-source value imports of marked modules (even
  from tools), through package subpaths, relative paths, re-exports and literal dynamic imports.
  Apps, tests, fakes and type-only imports are allowed; a marked module may import its own
  internals, but not another marked module. `harness/layout` validates unique direct kebab-case
  module folder names against `src/`. Set metadata through `npm pkg set`; generic dependencies
  on the rest of that workspace stay allowed. The model-adapter package restriction is unchanged.
- `createHarness` (`@sheavly/host/host/host.helper`) makes the session, task and approval registries around the provider the UI passed in. `createCodingHarness` (`@sheavly/coding/preset/coding.helper`) adds the opened `Workspace`, one `FileLocks` and one `ProcessRunner`. Neither adds a tool or a hook.
- The UI builds them on those services: `createTaskTools`, `createSubAgentTool`, `createMessageAgentTool` (`@sheavly/tools`), the file tools and `createRunCommandTool` (`@sheavly/coding`), `createAgentsMdHook` and `loadProjectHooks` (`@sheavly/workspace`). The backend app does it in `createBackendHarness` (`apps/backend/src/harness/harness.helper.ts`), with its settings (`Profiles` for the models and keys in `~/.sheavly`, `trustStoreFor`, `MAX_TURNS`) next to it; the terminal and other UIs reach it over HTTP.
- Generic code never needs a project on disk or a coding tool. The loop, `@sheavly/runtime` (sessions, tasks, approvals), `@sheavly/tools` (sub-agent, tasks) and `createHarness` (and their tests) import no workspace-bound service (`workspace`, `file-locks`, `process`, `trust`, `project-hooks`, `agents-md`) and no coding tool (`read-file`, `write-file`, `edit-file`, `files`, `run-command`). A generic test that needs a background task uses `startTaskTool` (`@sheavly/runtime/testing/start-task.fake`). See `docs/overview.md`, "The UI decides what a run includes".

The assembly above is written by hand in one place today, so what "coding" means is defined only in `createBackendHarness`. The direction is that it becomes an extension built the same way third parties build theirs ([principles.md](principles.md), #102); until then, add to that assembly only what a new extension would also have to add.
