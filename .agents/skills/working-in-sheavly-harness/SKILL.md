---
name: working-in-sheavly-harness
description: Conventions and workflow for changing the @sheavly/harness agent loop (TypeScript, Node 24 ESM): layer boundaries, module folders and `<name>.<kind>.ts` file kinds, adding tools/providers/events, tests in __tests__, and the Prettier + ESLint + tsc + knip + jscpd quality gate enforced by Cursor hooks. Use when editing any code in this project, adding a tool, adapter or loop event, writing tests, or when a hook reports lint, format, type, dead-code or duplication failures.
---

# Working in @sheavly/harness

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

**A new package, instead of a folder in an existing one**, when all of these hold: it has its own reason to change (not just more of what a package already does); something that shouldn't get the rest of an existing package needs it (a generic consumer, or a UI that needs only the wire contract); and its dependencies point down the graph. Otherwise it is a module folder in the package that owns the concern. Create a package or app with `npm run new` (see Packages), never by hand.

## Backend only: typed events, no UI

- The harness is a backend for UIs built on top of it. It emits typed events (loop `AgentEvent`s, `SessionUpdate`, `ApprovalUpdate`) and exposes registries a UI answers through (`approvals.respond`, `sessions.send`). It renders nothing, prompts no one and reads no terminal input.
- Something a user must see or decide is a typed event or a registry request, never a print or a prompt inside the harness. The UI subscribes and handles it its own way.
- Write UI code only when the chat's issue asks for a UI. Front ends are the apps (`apps/*`): `baseConfig` reads that from where a workspace is, so only an app's source may do terminal I/O, print or read env. A package never reads env, not even for one file: it takes the values, or an `Environment` (`@sheavly/core/environment/environment.types`), as options, and the app loads `.env` and passes `process.env` in (`providerFromEnv(process.env)`, `trustStoreFromEnv(process.env)`, `createCodingHarness({ env })`). The coverage test checks every package source file. `harness/no-terminal-io` fails terminal I/O (`node:readline`, `node:tty`, `process.stdin/stdout/stderr`) in every package; the terminal app's renderer writes through a function its entry points give it.
- `@sheavly/host` wires a run and holds no UI; nothing below the apps imports a front end.
- The library runs in-process, without a server: a UI embeds it (local tools, a remote model through its provider). A transport into it from outside its process (`@sheavly/server`, HTTP) is marked `sheavly.transport` and only an app depends on it (the layout check). It adds no behaviour: it turns requests into calls on what `@sheavly/host` serves, so in-process and remote UIs get the same.

## The UI decides what a run includes

- The packages provide pieces and the services a run shares; a UI picks the provider and composes the tools and hooks. No package picks a backend, a model, a tool or a hook for a run, and none reads settings. Enforced: `harness/imports` fails a package's source that imports a `*.tool` module other than from a tool (only apps and tests put tools together), and the layout check fails a package that depends at runtime on one holding model backends (`*.adapter.ts`).
- `createHarness` (`@sheavly/host/host/host.helper`) makes the session, task and approval registries around the provider the UI passed in. `createCodingHarness` (`@sheavly/coding/preset/coding.helper`) adds the opened `Workspace`, one `FileLocks` and one `ProcessRunner`. Neither adds a tool or a hook.
- The UI builds them on those services: `createTaskTools`, `createSubAgentTool`, `createMessageAgentTool` (`@sheavly/tools`), the file tools and `createRunCommandTool` (`@sheavly/coding`), `createAgentsMdHook` and `loadProjectHooks` (`@sheavly/workspace`). The backend app does it in `createTerminalHarness` (`apps/backend/src/harness/harness.helper.ts`), with its settings (`providerFromEnv`, `trustStoreFromEnv`, `MAX_TURNS`, the default model) next to it; the terminal and other UIs reach it over HTTP.
- Generic code never needs a project on disk or a coding tool. The loop, `@sheavly/runtime` (sessions, tasks, approvals), `@sheavly/tools` (sub-agent, tasks) and `createHarness` (and their tests) import no workspace-bound service (`workspace`, `file-locks`, `process`, `trust`, `project-hooks`, `agents-md`) and no coding tool (`read-file`, `write-file`, `edit-file`, `files`, `run-command`). A generic test that needs a background task uses `startTaskTool` (`@sheavly/runtime/testing/start-task.fake`). See `docs/overview.md`, "The UI decides what a run includes".

## Packages

Every workspace documents itself in two layers, and both change with it. Its `README.md` is the first place someone looks: what it is for, its public API (one row per module, matching its `exports`) and a short example, then a `## Docs` list. Its `docs/` folder goes deeper, one topic per file (how it works, why, how to extend it), each linked from the README. The root `docs/` holds only what spans workspaces (`overview.md`, `vision.md`) and the generated index of workspaces (`docs/README.md`). When you change a workspace's source, update its README or docs in the same change if what they say changed: the stop hook nudges once when a workspace's source changed but neither did (read from the workspaces, `docs.utils.mjs`). The layout check fails a workspace without a README, with an empty `docs/`, or with a doc its README doesn't link, and any relative link between docs that points at a missing file or heading.

npm workspaces in `packages/` (libraries) and `apps/` (front ends nothing imports), imported by subpath (`import { defineTool } from '@sheavly/core/tool/tool.utils'`), and only the file kinds a package's `exports` makes public (`"./*.types"`, `"./*.helper"`): its public API, so a new module of an exported kind needs no entry. Any other kind is internal, and `harness/imports` fails the import; make a kind public with `npm run export -- packages/<pkg> <kind>`, in review, never one file at a time (`harness/layout` fails a per-file entry). Packages are published, so `exports` is a semver contract: close a module that holds a public kind but isn't API (`"./hooks/*": null`), keep the README's API table to exactly the open modules (`harness/layout` fails either drifting), and ship only `dist` and `docs`, built by `prepack`. Each is built to its own `dist/` for plain Node (`npm run build`: each workspace's `tsc -b`, in dependency order through turbo); dev, tests and typecheck read its source through the `@sheavly/source` export condition, so nothing is built before `vitest` (`docs/overview.md`, "Packages").

- `packages/protocol`: the wire contract, everything sent to or accepted from a UI (`AgentEvent`, `SessionUpdate`, `ApprovalUpdate`, `ApprovalResponse` and the types inside them). Each is a zod schema in a `<module>.validator.ts`, its type `z.infer` of it in `<module>.types.ts`; never write a wire type by hand. It imports zod only (its `eslint.config.js` and `rootDir`). After changing a schema, run `npm run schema -w @sheavly/protocol`: a test fails while `contract.schema.json` is out of date. What a provider streams and the code contracts (`Tool`, `Hook`, `Adapter`) stay in core.
- `packages/core`: what tools and providers are written against. A new code contract shared by tools and providers goes here; one a UI sees goes in protocol.
- `packages/providers`: the model backends (`@sheavly/providers`). Only apps import it at runtime: the UI builds the `Provider` and passes it in (the layout check fails a package depending on it). One folder per protocol (`responses/`) and per backend (`openai/`, `azure/`); see its README for adding either. Tests that need the real loop with another package's code live in host (`packages/host/src/host/__tests__/`: providers, sub-agent tools).
- `packages/eslint-config`: `base.js` (the shared config), `file-kinds.js`, `rules/` (the `harness/*` rules, tested with RuleTester in `__tests__/`). A new convention is a rule here, used by every workspace.
- **Enforce what you add.** When you introduce a package, a convention or a pattern the harness doesn't check yet, add the check in the same change (a `harness/*` rule here, a `file-kinds.js` policy, a layout check, a test), never a gap or a doc-only note; derive it from the code (workspaces, file names, exports) rather than a hand-kept list, so it grows by itself, and make its message say what to do instead. `harness/single-definition` is the model: every `*.types.ts` in the workspaces owns the types it exports, read from disk, so a copy anywhere else (another folder, package or file, exported, local or re-exported) fails with where the original lives; exemptions go by file role (tests, fakes), never by name.
- A new package or app: `npm run new -- package|app <name> --domain <generic|coding|tooling> --description "…" [--depends-on core,protocol]`. It refuses a dependency the graph doesn't allow, creates the workspace through npm (never a hand-written `package.json`) with its configs and README, and prints the `npm install` to run with each dependency's first import. The layout check fails it until its first module lands, so no workspace stays empty. `npm run build` builds every workspace through turbo, each after the ones it imports.

## File structure

Each workspace holds one folder per module; everything about a module lives in it. Every file is `<name>.<kind>.ts` in kebab-case (`harness/file-kind`):

```
packages/coding/src/run-command/
  run-command.tool.ts        the tool (code only)
  run-command.types.ts       exported types only
  run-command.constants.ts   exported literal constants only
  run-command.utils.ts       pure helpers (no I/O, no services)
  arguments.helper.ts        stateless functions that do I/O (workspace checks)
  __tests__/run-command.tool.test.ts
```

Kinds: `types`, `constants`, `utils`, `validator`, `helper`, `service`, `tool`, `adapter`, `routes` (one group of HTTP routes), `errors`, `fake` (a `testing/` folder), `test`. Policies (exports, classes, schemas, max lines) are in `packages/eslint-config/src/file-kinds.js`; a genuinely new kind is added there. Which of the code kinds a file is, lint decides:

- `utils`: pure, no I/O, no services. `validator`: pure too, and only validation: zod schemas for external input (files, env, API events, hook exports) and the `parse*` functions that turn `unknown` into typed data. Validate with `parseOrThrow` / `validate` from `@sheavly/core/validation/validation.validator`, passing your area's typed error.
- `helper`: stateless functions that may do I/O or call services; it exports no class. `service`: owns state, so it exports a class. State with order or a lifecycle (queues, live processes) lives in a service the host creates and injects, never at module level, so tests don't share it.

- A code file never exports a type or a literal constant: move it to the module's `*.types.ts` / `*.constants.ts`. A `*.service.ts` without a class, a `*.helper.ts` with one, and an exported zod schema outside a `*.validator.ts` fail too (`harness/kind-contents`). Unexported local ones may stay.
- `*.types.ts` imports only with `import type`; derive schema types there with `z.infer<typeof xSchema>`.
- Module-level functions with more than one input (outside tests) take one destructured `params` object: `function f(params: { a: A; b: B }) { const { a, b } = params; }`.
- `type`, never `interface`. Named exports only. No re-exports (barrels): import from the defining file. Name caught errors `caughtError`.
- No deprecated APIs (`@typescript-eslint/no-deprecated`, in `.ts` and `.js`/`.mjs` alike): use the replacement the error names, never a workaround that hides the `@deprecated` tag.
- Import from the defining file (`../files/files.utils.js`) or a package subpath (`@sheavly/runtime/tasks/tasks.service`).
- When a file hits its kind's line limit, split it by responsibility into another `<name>.<kind>.ts` in the same folder (as `stream-agent/` does with `turn.helper.ts` and `sample.helper.ts`).

## Adding things

**A tool**: create `packages/tools/src/<name>/` (generic) or `packages/coding/src/<name>/` (files or commands), copying the shape of `@sheavly/coding`'s `read-file/`. `defineTool` and the `Tool` types come from `@sheavly/core/tool/tool.utils` / `tool/tool.types` (`runTool` from `tool/tool.helper`).

- `<name>.tool.ts`: `create<Name>Tool(options)` returns `defineTool({ name, description, inputSchema, execute })`.
- `inputSchema` is a `z.object`. Never add a `description` field: the harness adds the model's call description itself and strips it before `execute`.
- `execute({ input, signal, context })` returns a string, or `{ content, artifacts }` to give a UI data the model never sees (tagged with a `kind` the tool owns, e.g. the file tools' `FileChange`: emitted on `tool_result`, never put in history; see `docs/tools.md`, "Artifacts"). It throws `Error`s with clear messages (`runTool` turns them into error results). Pass `signal` to every async operation.
- All file access goes through `Workspace` (`resolveRead` / `resolveWrite`); writing tools use `resolveWritable` from `@sheavly/coding/files/files.helper`. Never read or write `.env*` files. Commands go through the harness's `ProcessRunner` (`@sheavly/workspace/process/process.service`) and the allow list.
- Include it from the UI that wants it (the terminal app: `createTerminalHarness`), with `*.tool` exported by its package (`npm run export -- packages/<pkg> tool`). No package adds a tool to a run.

**A sub-agent**: `createSubAgentTool({ sessions, tasks, provider, runAgent: runSession, tools, hooks? })` (`@sheavly/tools/sub-agent/`). Every run is a session in a `SessionRegistry` (`@sheavly/runtime/sessions/`): pass `session: { registry, ref }` to the loop, or it starts its own main session. Sub-agents nest at most `MAX_SESSION_DEPTH` (3), always under a running parent, and report their own status with `report_status`; a parent steers one with `message_agent` (the session inbox: `sessions.send`, delivered at the next model call). `sessions.stream()` is the SSE feed. See `docs/sessions.md`.

**A provider**: see `packages/providers/docs/backends.md`. A Responses API backend is one folder, `packages/providers/src/<name>/<name>.adapter.ts`, using `defineResponsesAdapter({ kind, description, configSchema, toEndpoint })` (from `responses/responses.helper.ts`): a pure map from config to endpoint. Another protocol (Anthropic, Gemini, Chat Completions) gets its own protocol folder next to `responses/` and backends on it; it never reuses `responses/`. Anything else uses `defineAdapter` (from `@sheavly/core/adapter/adapter.utils`). Register built-ins in `registry/default-registry.helper.ts`. Adapters have no default model; the app that builds the provider picks it. Core code doesn't change.

**A loop event**: add its schema to `agentEventBodySchema` in `packages/protocol/src/event/event.validator.ts` (then `npm run schema -w @sheavly/protocol`) and emit it through the `OrderedQueue`, never directly, so `seq` stays contiguous and in causal order. Render it in the terminal app's `Renderer` (`apps/terminal/src/render/`).

**A route** (the HTTP API): one entry in `API_ROUTES` (`packages/protocol/src/api/api.constants.ts`), named after what it does (`get…`/`list…`/`query…`/`stream…` for a read, a verb for a change), with its body and answer as schemas in `server/server.validator.ts`. Declare its `effect`: `ApiRoute` then allows only the methods that fit, so the typecheck fails a read on `post` or a `get` with a body. A read without input is `get`; a read with input (a filter, a search, a resume point) is `query`, its input a typed body, never a query string; a change is `post`, `put` (setting a value) or `delete`. Then run `npm run schema -w @sheavly/protocol` (a test fails while `openapi.json` is stale, and another holds each route's name and path to these rules), implement it in the server, and call it from the client.

**A hook**: `defineHook({ name, sessionStart?, beforeTurn?, aroundToolCall?, afterTurn?, onError? })` from `@sheavly/core/hook/hook.utils`, passed in the loop's `hooks` option (order matters). `sessionStart` (once per run) and `beforeTurn` add context with `addContext` (a user message kept in history, emitted as `context_added`); `beforeTurn` can also `addInstructions` (system instructions for that model call only, appended to the run's `instructions` option, never in history; the built-in `createAgentsMdHook` in `@sheavly/workspace` (`agents-md/`) uses it); `aroundToolCall` calls `next()` to continue, or returns a result to block; `afterTurn` sees the turn's reply with tool results in history; `onError` is told when the run fails (the run's error is rethrown; a handler that throws doesn't stop the others and is reported as a `hook_failed` event). A new hook point is a new optional handler on `Hook`, added to `HANDLERS` in `hook.utils.ts` and run from `@sheavly/loop/hooks/hooks.helper`.

**A project hook** (`.sheavly/`): listed in `.sheavly/hooks.json`, loaded by `@sheavly/workspace/project-hooks/` with a native `import()`, its default export validated with zod. A new handler on `Hook` must also be added to `hookExportSchema` in `project-hooks.validator.ts` (a `satisfies` check fails the typecheck if it is missing). Tests write real temp projects; `vitest.config.ts` keeps Vite away from `.sheavly` files so Node's own ESM/CommonJS/TypeScript rules apply.

## Rules

- All external input is validated with zod (tool inputs, adapter config, env).
- Interrupts must leave history valid: every tool call gets a result message, even a placeholder.
- Keep files within their kind's line limit (`file-kinds.js`; `utils` has none, since pure helpers grow with their subject) and functions under the cognitive-complexity limit. Split into small helpers rather than fighting the rule.
- No `eslint-disable` comments (`noInlineConfig`). A justified exception is a `files:` override in the workspace's `eslint.config.js`, with a reason.
- Fakes live in `@sheavly/testing`, by what they fake: `provider/` (`scriptedProvider`, `callOnceProvider`, `routedProvider`), `fetch/` (`fakeFetch`, `collect`, `requestSentBy`), `tool/` (`toolRunner`) and `wait/` (`until`). It is test-only (`sheavly.testOnly`): a dev dependency, imported only from tests and fakes (`harness/imports`), and lint treats all its source as test code. A package's own fakes stay in its `src/testing/`: `@sheavly/runtime/testing/` (sessions, approvals, `startTaskTool`), `@sheavly/workspace/testing/` (`useTempWorkspace`, `useFileLocks`), `packages/providers/src/testing/`; core keeps its echo tool in `packages/core/src/testing/`, since core can't depend on the testing package built on it. No mock data in dev or prod code.
- Never edit `package.json` by hand: use `npm install -D <pkg>` / `npm pkg set`.
- Fail loudly. A `catch` rethrows, or checks the error (`code`, `instanceof`) and handles only what it expects, with a comment saying why; a rethrow with a better message keeps `cause` (`harness/no-silent-catch`). Guards fail closed and say why. Source never creates a plain `Error`: throw a typed class from the area's errors (each workspace's `src/errors/`, `.cursor/hooks/hooks.errors.mjs`), adding one if none fits (`harness/no-raw-error`; tests, fakes and `scripts/` are exempt).
- Real-model checks: when a change alters what a run does, run `npm run workbook -- check` once it's done (the `/git` review step asks for it, and the stop hook nudges once). It runs only the checks whose `areas` the change touched. A new behaviour gets a `check` on a stored prompt (`workbook/README.md`). It's manual and on demand: never put it in CI or `npm run check`, and don't run the demo (`npm run demo`) or the workbook otherwise, since both call a paid model API.

## Tests

- Tests go in `<module>/__tests__/<name>.<kind>.test.ts`. Anywhere else, ESLint fails it and Vitest never runs it.
- Use `scriptedProvider` / `fakeFetch` (`@sheavly/testing`) and temporary directories. Tests never touch the network.
- Cover the guard paths too (rejections, aborts, ordering), not just the happy path.

## Quality gate

```bash
npm run check            # the whole gate through turbo (turbo.json): each workspace's typecheck, lint, test, then the root's, plus prettier, knip, jscpd and the layout check
npm run check:affected   # only the workspaces changed since main and their dependents; repo-wide checks in full
npm run check -- --force # bypass the turbo cache
npx turbo run test --filter=@sheavly/core   # one workspace's task (or `npm run test -w @sheavly/core`)
npm run lint:fix   # ESLint auto-fixes, then Prettier (in that order)
npm run format     # Prettier only
```

Every workspace has its own `typecheck`, `lint` and `test` scripts that check only its files; a new package needs all three. Results are cached in `.turbo/cache` by their inputs, so a change reruns only its workspace and the ones that import it.

knip (unused files, exports, types, dependencies; `knip.json`) and jscpd (copied code; `.jscpd.json`) fail on any finding: there is no baseline. Remove dead code; reuse or extract duplicated code. Never add `jscpd:ignore` comments. After deleting dead code, re-run `npm run knip`: removing one export often leaves what it used unused. `npx knip --fix --fix-type exports,types` is allowed; never the `dependencies`/`files` fix types. Root tooling scripts live in `scripts/` (plain Node ESM, tests in `scripts/__tests__/`).

Cursor hooks (`.cursor/hooks.json`) run this automatically:

- **After each Write**, the edited file is formatted with Prettier, then linted. If the hook says "Prettier reformatted the file", re-read the file before editing it again, since old `old_string` text may no longer match. The first edit of harness source in a chat injects "Backend only" and "Where code goes" from this skill, and the first edit inside a workspace shows that workspace's README (once per workspace per chat). The list of workspaces is the `sheavly-packages` skill, a router generated from their `package.json` (`npm run graph`; the layout check fails when it is stale). The first edit of a file a skill governs also names that skill (once per skill per chat): each skill in `.agents/skills/` has a `harness.json` beside its SKILL.md with `governs` globs (or an empty list and a `manual` reason). A new skill needs one, and a test fails on a glob that matches no file. TypeScript written outside every workspace's `src/` (other than `NOT_SOURCE` in `layout.js`) is reported on the edit, and the stop hook runs the layout check with the rest of the gate. The layout check also holds the words to the code: the graph in `docs/overview.md` is current and drawn nowhere else, no doc or comment names a path in the old root `src/` (one starting `src/<workspace>`), source names no issue number, and no doc promises what an issue will do ("until" or "once" one lands). Say what is true now; history and plans live in the issue. It also holds AGENTS.md and the skills to the code: every path, import, `npm run` script, `harness/*` rule and code name they put in backticks must exist (`scripts/rule-references.mjs`). A reference meant to point outside the repo (a `gh --json` field, a library API) goes in `scripts/rule-references.allowlist.json` with its reason; an entry nothing needs any more fails too.
- **Before each shell command**, the shell guard (`guard-shell-commands.mjs`, its checks in `shell-guard.utils.mjs`) denies in-place shell editors (`sed -i`, `perl -pi`, `awk -i inplace`, scripted `vim`/`ex`/`ed`) on project files: those edits skip the hooks above and show no diff. Edit with StrReplace/Write; read-only uses (`sed -n`, `sed 's/a/b/' file` to stdout) and files outside the project stay allowed. It snapshots the project before each command it allows; **after it**, `record-shell-writes.mjs` compares, records any changed files for the stop hook's gate, and reports a command that changed files and isn't a known writer (`SANCTIONED_WRITERS` in `shell-writes.utils.mjs`, grown only by the user) as a workaround. Add it to `DENIED_CASES` (`shell-guard-cases.utils.mjs`) and teach the guard the technique: the stop hook fails until the guard denies it, and whenever a case committed at `HEAD` was removed.
- **On stop**, typecheck and ESLint run through turbo (so cached results are reused), then Prettier check, knip, the layout check and jscpd, but only for a chat that edited or deleted project source in this checkout. Each chat records the files it edits (`.cursor/hooks/chat-files.utils.mjs`; the Write and Delete hook, and the after-shell hook for a command's changes), and the gate holds it to those: turbo runs for their workspaces and the workspaces importing them, Prettier for the files themselves, and the repo-wide checks report only the problems naming them or their workspaces (`gate-scope.utils.mjs`). Several chats can share a checkout, so a dependent workspace holding another chat's uncommitted edits is left to that chat, and the after-shell hook doesn't count a file another chat edited while the command ran. A chat that only answered questions or worked in another worktree is not checked. CI runs the whole gate on every PR, so nothing left out here goes unchecked. A failure comes back as a follow-up message (up to 3 rounds): fix the cause in code, never by suppressing it. Once they pass, the docs nudge runs (see Packages).
- **Subagents** (the Task tool) get no `beforeSubmitPrompt` of their own, so `record-subagent.mjs` (`subagentStart`) links each Task call to the chat that made it, and every hook of the subagent links it to its call (`chat-links.utils.mjs`). A subagent's git commands answer to its parent's issues and approvals, and its edits are its parent's to check: the parent's stop hook waits while one still works (`record-subagent-stop.mjs` marks it done; one silent for `SUBAGENT_IDLE_TIMEOUT_MS` stops holding it back and is named once, `subagents.utils.mjs`), then checks what the chat and every subagent below it edited.

Formatting is single quotes, semicolons, trailing commas and 100 columns (`.prettierrc.json`). Don't hand-format: let Prettier do it.

Finish a change only when `npm run check` passes.

## Git and GitHub

GitHub Issues is the only tracker; never Jira or anything else. All git and GitHub work goes through the `/git` skill (`.agents/skills/git/`): one issue, one branch `<issue>-<kebab-name>` off `main`, one PR; or a stack of PRs, each based on the layer below (`stacks.md`), lower layers ending `Part of #123`. Commits are `type(scope): subject` with a `Refs: #123` footer, one scope each in build order; the PR title is the same header format, and its body ends with `Closes #123`. Stage named files only, push rewrites with `--force-with-lease` and only on draft PRs, merge with `--squash` (`gh stack merge <pr> --yes --squash` for a stack), cherry-pick only after the user writes "allow cherry-pick". A chat's first prompt names its issue (`#123`) or starts with `NO-ISSUE`. The git guard (`beforeShellExecution`) denies commands that break these; `.agents/skills/git/conventions.md` has the formats with examples.
