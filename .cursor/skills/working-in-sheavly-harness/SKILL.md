---
name: working-in-sheavly-harness
description: Conventions and workflow for changing the @sheavly/harness agent loop (TypeScript, Node 24 ESM): layer boundaries, module folders and `<name>.<kind>.ts` file kinds, adding tools/providers/events, tests in __tests__, and the Prettier + ESLint + tsc + knip + jscpd quality gate enforced by Cursor hooks. Use when editing any code in this project, adding a tool, adapter or loop event, writing tests, or when a hook reports lint, format, type, dead-code or duplication failures.
---

# Working in @sheavly/harness

## Layers (imports only point down)

```
@sheavly/protocol  ←  @sheavly/core  ←  @sheavly/providers, runtime  ←  tools  ←  loop  ←  host  ←  front ends
```

| Layer                | Holds                                                                                                   | May import              |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------- |
| `packages/protocol`  | `@sheavly/protocol`: the wire contract (events, updates, answers) as zod schemas                        | zod only                |
| `packages/core`      | `@sheavly/core`: code contracts, `defineTool`/`runTool`, `defineAdapter`                                | protocol, zod           |
| `packages/providers` | `@sheavly/providers`: protocol layers, backends, registry, switch                                       | protocol, core, zod     |
| `packages/runtime`   | `@sheavly/runtime`: the generic services, sessions, tasks, approvals                                    | protocol, core          |
| `src/runtime/`       | The workspace-bound services, until #29 moves them: workspace confinement, processes, trust, file locks | protocol, core, runtime |
| `packages/tools`     | `@sheavly/tools`: the generic tools, sub-agents and tasks                                               | protocol, core, runtime |
| `src/tools/`         | The coding tools, until #29 moves them                                                                  | protocol, core, runtime |
| `packages/loop`      | `@sheavly/loop`: `streamAgent` / `runAgent`, events, queue, abort, hooks                                | protocol, core, runtime |
| `packages/host`      | `@sheavly/host`: `createHarness`, wires a run, the model from env. No UI                                | all above               |
| `src/host/`          | `createCodingHarness`, the coding preset, until #29 moves it                                            | all above               |
| Front ends           | `src/terminal-ui/` (the `Renderer`), `src/workbook/`, `src/demo.ts`                                     | anything                |

ESLint enforces this (`harness/imports`). The layout is read from the workspaces: kind from the folder (`packages/*`, `apps/*`), the graph from each `package.json`'s dependencies, the domain from its `sheavly.domain`; only this app's `src/` layers (until #29 splits it) and `NOT_SOURCE` are written by hand, in `packages/eslint-config/src/layout.js`. A workspace without a domain, or a `src/` folder that isn't a layer, fails `harness/layout`. If an import is rejected, pass the dependency in as an option instead of moving the rule.

## Where code goes

Decide where something lives before writing it. The first question: **would a non-coding LLM project (a text extractor, a chat wrapper) need this?** Yes: it is generic, and goes where it knows nothing about files, workspaces or code. No: it is coding, and only the coding preset reaches it. Then pick the row. Until #29 finishes splitting the app, some homes are still `src/` folders; the last column is the package each one becomes.

| You are adding…                                                                 | It goes in                                                            | Once #29 lands       |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------- |
| Something sent to or accepted from a UI (an event, an update, an answer)        | `@sheavly/protocol`: a schema in `<module>.validator.ts`              | (already a package)  |
| A loop event                                                                    | `@sheavly/protocol` (`agentEventBodySchema`), then `@sheavly/loop`    | (already packages)   |
| A code contract tools or providers are written against (`Tool`, `Hook`, …)      | `@sheavly/core`                                                       | (already a package)  |
| A model backend, or a new provider protocol                                     | `@sheavly/providers` (its README)                                     | (already a package)  |
| A stateful service the host creates (tasks, sessions, approvals)                | `@sheavly/runtime`                                                    | (already a package)  |
| A generic tool (no files, no commands)                                          | `@sheavly/tools`                                                      | (already a package)  |
| A change to how a run goes: turns, tool calls, hooks, the event stream          | `@sheavly/loop`                                                       | (already a package)  |
| Anything that needs a project on disk (the workspace, trust, `.sheavly/` hooks) | `src/runtime/<module>/`, reached only from the coding preset          | `@sheavly/workspace` |
| A coding tool (files, commands) or a change to the coding preset                | `src/tools/<name>/`, `src/host/coding.helper.ts`                      | `@sheavly/coding`    |
| Wiring a run, a transport, the model from env                                   | `@sheavly/host`                                                       | (already a package)  |
| A fake for tests                                                                | `@sheavly/testing` (one that needs the app's runtime: `src/testing/`) | (already a package)  |
| A lint rule, a file kind, a layout policy                                       | `@sheavly/eslint-config`                                              | (already a package)  |
| A UI: something that renders or reads the terminal                              | `src/terminal-ui/`, `src/workbook/`, `src/demo.ts`                    | `apps/<name>`        |

**A new package, instead of a folder in an existing one**, when all of these hold: it has its own reason to change (not just more of what a package already does); something that shouldn't get the rest of an existing package needs it (a generic consumer, or a UI that needs only the wire contract); and its dependencies point down the graph. Otherwise it is a module folder in the package that owns the concern. Create a package or app with `npm run new` (see Packages), never by hand.

## Backend only: typed events, no UI

- The harness is a backend for UIs built on top of it. It emits typed events (loop `AgentEvent`s, `SessionUpdate`, `ApprovalUpdate`) and exposes registries a UI answers through (`approvals.respond`, `sessions.send`). It renders nothing, prompts no one and reads no terminal input.
- Something a user must see or decide is a typed event or a registry request, never a print or a prompt inside the harness. The UI subscribes and handles it its own way.
- Write UI code only when the chat's issue asks for a UI. Front ends live only in the files named in `FRONT_END_FILES` (`eslint.config.js`): `src/demo.ts`, `src/terminal-ui/`, `src/workbook/`. `harness/no-terminal-io` fails terminal I/O anywhere else (`node:readline`, `node:tty`, `process.stdin/stdout/stderr`), in every workspace; adding a file to that list is a reviewed change.
- `@sheavly/host` wires a run and holds no UI; nothing below the apps imports a front end.

## Two entry points: generic, and coding on top

- `createHarness` (`@sheavly/host/host/host.helper`) is for any LLM project, with or without a repo: the caller's `tools` and `hooks`, plus the task and sub-agent tools and the registries. It opens no workspace, reads no AGENTS.md or `.sheavly/` and needs no trust store.
- `createCodingHarness` (`src/host/coding.helper.ts`, until #29 moves it) is the coding preset the demo and the workbook use: it opens the `Workspace`, checks trust, loads the AGENTS.md and `.sheavly/` hooks, adds the file tools and `run_command` (sharing one `FileLocks` and one `ProcessRunner`), then calls `createHarness`.
- Generic code never needs a project on disk or a coding tool. The loop, `@sheavly/runtime` (sessions, tasks, approvals), `@sheavly/tools` (sub-agent, tasks) and `createHarness` (and their tests) import no workspace-bound service (`workspace`, `file-locks`, `process`, `trust`, `project-hooks`, `agents-md`) and no coding tool (`read-file`, `write-file`, `edit-file`, `files`, `run-command`). A generic test that needs a background task uses `startTaskTool` (`@sheavly/runtime/testing/start-task.fake`). New coding wiring goes in the preset, never in `createHarness`. See `docs/overview.md`, "Entry points".

## Packages

Design docs live in `docs/` (overview, tools, hooks, sessions). When a feature lands, update its doc in the same change. The stop hook nudges you once when source files changed but the doc describing them didn't (`DOC_SOURCES` in `.cursor/hooks/docs.utils.mjs`); update the doc if what it says changed, otherwise just finish.

npm workspaces in `packages/`, imported by subpath (`import { defineTool } from '@sheavly/core/tool/tool.utils'`). Each is built to its own `dist/` for plain Node (`npm run build`, `tsc -b` in dependency order); dev, tests and typecheck read its source through the `@sheavly/source` export condition, so nothing is built before `vitest` (`docs/overview.md`, "Packages").

- `packages/protocol`: the wire contract, everything sent to or accepted from a UI (`AgentEvent`, `SessionUpdate`, `ApprovalUpdate`, `ApprovalResponse` and the types inside them). Each is a zod schema in a `<module>.validator.ts`, its type `z.infer` of it in `<module>.types.ts`; never write a wire type by hand. It imports zod only (its `eslint.config.js` and `rootDir`). After changing a schema, run `npm run schema -w @sheavly/protocol`: a test fails while `contract.schema.json` is out of date. What a provider streams and the code contracts (`Tool`, `Hook`, `Adapter`) stay in core.
- `packages/core`: what tools and providers are written against. It may not import the app (`rootDir` makes that a type error). A new code contract shared by tools and providers goes here; one a UI sees goes in protocol.
- `packages/providers`: the model backends (`@sheavly/providers`), imported only by `@sheavly/host` and `src/index.ts`. One folder per protocol (`responses/`) and per backend (`openai/`, `azure/`); see its README for adding either. Tests that need the real loop live in the app (`src/host/__tests__/providers.test.ts`).
- `packages/eslint-config`: `base.js` (the shared config), `file-kinds.js`, `rules/` (the `harness/*` rules, tested with RuleTester in `__tests__/`). A new convention is a rule here, used by every workspace.
- **Enforce what you add.** When you introduce a package, a convention or a pattern the harness doesn't check yet, add the check in the same change (a `harness/*` rule here, a layer in `layout.js`, a `file-kinds.js` policy, a test), never a gap or a doc-only note; derive it from the code (workspaces, file names, exports) rather than a hand-kept list, so it grows by itself, and make its message say what to do instead. `harness/single-definition` is the model: every `*.types.ts` in the app and the packages owns the types it exports, read from disk, so a copy anywhere else (another folder, package or file, exported, local or re-exported) fails with where the original lives; exemptions go by file role (tests, fakes), never by name.
- A new package or app: `npm run new -- package|app <name> --domain <generic|coding|tooling> --description "…" [--depends-on core,protocol]`. It refuses a dependency the graph doesn't allow, creates the workspace through npm (never a hand-written `package.json`) with its configs, README and a first test, and prints the `npm install` to run with each dependency's first import. It passes `npm run check` as it is. Reference a package you build for plain Node from the root `tsconfig.build.json` (or from a package that depends on it).

## File structure

Each layer holds one folder per module; everything about a module lives in it. Every file is `<name>.<kind>.ts` in kebab-case (`harness/file-kind`):

```
src/tools/run-command/
  run-command.tool.ts        the tool (code only)
  run-command.types.ts       exported types only
  run-command.constants.ts   exported literal constants only
  run-command.utils.ts       pure helpers (no I/O, no services)
  arguments.helper.ts        stateless functions that do I/O (workspace checks)
  __tests__/run-command.tool.test.ts
```

Kinds: `types`, `constants`, `utils`, `validator`, `helper`, `service`, `tool`, `adapter`, `errors`, `fake` (a `testing/` folder), `test`. Policies (exports, classes, schemas, max lines) are in `packages/eslint-config/src/file-kinds.js`; a genuinely new kind is added there. Which of the code kinds a file is, lint decides:

- `utils`: pure, no I/O, no services. `validator`: pure too, and only validation: zod schemas for external input (files, env, API events, hook exports) and the `parse*` functions that turn `unknown` into typed data. Validate with `parseOrThrow` / `validate` from `@sheavly/core/validation/validation.validator`, passing your area's typed error.
- `helper`: stateless functions that may do I/O or call services; it exports no class. `service`: owns state, so it exports a class. State with order or a lifecycle (queues, live processes) lives in a service the host creates and injects, never at module level, so tests don't share it.

- A code file never exports a type or a literal constant: move it to the module's `*.types.ts` / `*.constants.ts`. A `*.service.ts` without a class, a `*.helper.ts` with one, and an exported zod schema outside a `*.validator.ts` fail too (`harness/kind-contents`). Unexported local ones may stay.
- `*.types.ts` imports only with `import type`; derive schema types there with `z.infer<typeof xSchema>`.
- Module-level functions with more than one input (outside tests) take one destructured `params` object: `function f(params: { a: A; b: B }) { const { a, b } = params; }`.
- `type`, never `interface`. Named exports only. No re-exports (barrels) except `src/index.ts`, the package entry. Name caught errors `caughtError`.
- No deprecated APIs (`@typescript-eslint/no-deprecated`, in `.ts` and `.js`/`.mjs` alike): use the replacement the error names, never a workaround that hides the `@deprecated` tag.
- Import from the defining file (`../files/files.utils.js`) or a package subpath (`@sheavly/runtime/tasks/tasks.service`), never from `src/index.ts`.
- When a file hits its kind's line limit, split it by responsibility into another `<name>.<kind>.ts` in the same folder (as `stream-agent/` does with `turn.helper.ts` and `sample.helper.ts`).

## Adding things

**A tool**: create `src/tools/<name>/`, copying the shape of `tools/read-file/`. `defineTool` and the `Tool` types come from `@sheavly/core/tool/tool.utils` / `tool/tool.types` (`runTool` from `tool/tool.helper`).

- `<name>.tool.ts`: `create<Name>Tool(options)` returns `defineTool({ name, description, inputSchema, execute })`.
- `inputSchema` is a `z.object`. Never add a `description` field: the harness adds the model's call description itself and strips it before `execute`.
- `execute({ input, signal, context })` returns a string, or `{ content, artifacts }` to give a UI data the model never sees (tagged with a `kind` the tool owns, e.g. the file tools' `FileChange`: emitted on `tool_result`, never put in history; see `docs/tools.md`, "Artifacts"). It throws `Error`s with clear messages (`runTool` turns them into error results). Pass `signal` to every async operation.
- All file access goes through `Workspace` (`resolveRead` / `resolveWrite`); writing tools use `resolveWritable` from `tools/files/files.helper.ts`. Never read or write `.env*` files. Commands go through the harness's `ProcessRunner` (`runtime/process/process.service.ts`) and the allow list.
- Wire the tool into `src/demo.ts`, and export it from `src/index.ts`.

**A sub-agent**: `createSubAgentTool({ sessions, tasks, provider, runAgent: runSession, tools, hooks? })` (`@sheavly/tools/sub-agent/`). Every run is a session in a `SessionRegistry` (`@sheavly/runtime/sessions/`): pass `session: { registry, ref }` to the loop, or it starts its own main session. Sub-agents nest at most `MAX_SESSION_DEPTH` (3), always under a running parent, and report their own status with `report_status`; a parent steers one with `message_agent` (the session inbox: `sessions.send`, delivered at the next model call). `sessions.stream()` is the SSE feed. See `docs/sessions.md`.

**A provider**: see `packages/providers/README.md`. A Responses API backend is one folder, `packages/providers/src/<name>/<name>.adapter.ts`, using `defineResponsesAdapter({ kind, description, configSchema, toEndpoint })` (from `responses/responses.helper.ts`): a pure map from config to endpoint. Another protocol (Anthropic, Gemini, Chat Completions) gets its own protocol folder next to `responses/` and backends on it; it never reuses `responses/`. Anything else uses `defineAdapter` (from `@sheavly/core/adapter/adapter.utils`). Register built-ins in `registry/default-registry.helper.ts`. Adapters have no default model; the caller (the host) picks it. Core code doesn't change.

**A loop event**: add its schema to `agentEventBodySchema` in `packages/protocol/src/event/event.validator.ts` (then `npm run schema -w @sheavly/protocol`) and emit it through the `OrderedQueue`, never directly, so `seq` stays contiguous and in causal order. Render it in `demo.ts`.

**A hook**: `defineHook({ name, sessionStart?, beforeTurn?, aroundToolCall?, afterTurn?, onError? })` from `@sheavly/core/hook/hook.utils`, passed in the loop's `hooks` option (order matters). `sessionStart` (once per run) and `beforeTurn` add context with `addContext` (a user message kept in history, emitted as `context_added`); `beforeTurn` can also `addInstructions` (system instructions for that model call only, appended to the run's `instructions` option, never in history; the built-in `createAgentsMdHook` in `runtime/agents-md/` uses it); `aroundToolCall` calls `next()` to continue, or returns a result to block; `afterTurn` sees the turn's reply with tool results in history; `onError` is told when the run fails (the run's error is rethrown; a handler that throws doesn't stop the others and is reported as a `hook_failed` event). A new hook point is a new optional handler on `Hook`, added to `HANDLERS` in `hook.utils.ts` and run from `@sheavly/loop/hooks/hooks.helper`.

**A project hook** (`.sheavly/`): listed in `.sheavly/hooks.json`, loaded by `runtime/project-hooks/` with a native `import()`, its default export validated with zod. A new handler on `Hook` must also be added to `hookExportSchema` in `project-hooks.validator.ts` (a `satisfies` check fails the typecheck if it is missing). Tests write real temp projects; `vitest.config.ts` keeps Vite away from `.sheavly` files so Node's own ESM/CommonJS/TypeScript rules apply.

## Rules

- All external input is validated with zod (tool inputs, adapter config, env).
- Interrupts must leave history valid: every tool call gets a result message, even a placeholder.
- Keep files within their kind's line limit (`file-kinds.js`; `utils` has none, since pure helpers grow with their subject) and functions under the cognitive-complexity limit. Split into small helpers rather than fighting the rule.
- No `eslint-disable` comments (`noInlineConfig`). A justified exception is a `files:` override in `eslint.config.js`, with a reason.
- Fakes live in `@sheavly/testing`, by what they fake: `provider/` (`scriptedProvider`, `callOnceProvider`, `routedProvider`), `fetch/` (`fakeFetch`, `collect`, `requestSentBy`), `tool/` (`toolRunner`) and `wait/` (`until`). It is test-only (`sheavly.testOnly`): a dev dependency, imported only from tests and fakes (`harness/imports`), and lint treats all its source as test code. Fakes that need the app's runtime stay in `src/testing/` until their package exists; a package's own fakes stay in its `src/testing/` (`packages/providers/src/testing/`); core keeps its echo tool in `packages/core/src/testing/`, since core can't depend on the testing package built on it. No mock data in dev or prod code.
- Never edit `package.json` by hand: use `npm install -D <pkg>` / `npm pkg set`.
- Fail loudly. A `catch` rethrows, or checks the error (`code`, `instanceof`) and handles only what it expects, with a comment saying why; a rethrow with a better message keeps `cause` (`harness/no-silent-catch`). Guards fail closed and say why. Source never creates a plain `Error`: throw a typed class from the area's errors (`src/runtime/errors/`, `packages/providers/src/errors/`, `packages/core/src/errors/`, `.cursor/hooks/hooks.errors.mjs`), adding one if none fits (`harness/no-raw-error`; tests, fakes and `scripts/` are exempt).
- Real-model checks: when a change alters what a run does, run `npm run workbook -- check` once it's done (the `/git` review step asks for it, and the stop hook nudges once). It runs only the checks whose `areas` the change touched. A new behaviour gets a `check` on a stored prompt (`workbook/README.md`). It's manual and on demand: never put it in CI or `npm run check`, and don't run `src/demo.ts` or the workbook otherwise, since both call a paid model API.

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

Every workspace has its own `typecheck`, `lint` and `test` scripts that check only its files; a new package needs all three. Results are cached in `.turbo/cache` by their inputs; while the app is the root package, a change in core or providers reruns everything (#29).

knip (unused files, exports, types, dependencies; `knip.json`) and jscpd (copied code; `.jscpd.json`) fail only on findings not in `knip-baseline.json` / `.jscpd-baseline.json`. Remove dead code; reuse or extract duplicated code. Never hand-edit the baselines or add `jscpd:ignore` comments; after fixing baselined debt run `npm run knip:baseline` / `npm run jscpd:baseline` (prune-only: they never add entries). After deleting dead code, re-run `npm run knip`: removing one export often leaves what it used unused. `npx knip --fix --fix-type exports,types` is allowed; never the `dependencies`/`files` fix types. Root tooling scripts live in `scripts/` (plain Node ESM, tests in `scripts/__tests__/`).

Cursor hooks (`.cursor/hooks.json`) run this automatically:

- **After each Write**, the edited file is formatted with Prettier, then linted. If the hook says "Prettier reformatted the file", re-read the file before editing it again, since old `old_string` text may no longer match. The first edit of harness source in a chat injects "Backend only" and "Where code goes" from this skill (a test fails if "Where code goes" misses a workspace). The first edit of a file a skill governs also names that skill (once per skill per chat): each skill in `.cursor/skills/` has a `harness.json` beside its SKILL.md with `governs` globs (or an empty list and a `manual` reason). A new skill needs one, and a test fails on a glob that matches no file. TypeScript written outside every workspace's `src/` (other than `NOT_SOURCE` in `layout.js`) is reported on the edit, and the stop hook runs the layout check with the rest of the gate.
- **On stop**, typecheck and ESLint run for the affected workspaces (through turbo, so cached results are reused), then Prettier check, knip and jscpd on the whole repo, but only for a chat that edited or deleted project source in this checkout (recorded by the Write and Delete hook). A chat that only answered questions, worked in another worktree or edited only through the shell is not checked, so it never gets another chat's unfinished work. A failure comes back as a follow-up message (up to 3 rounds): fix the cause in code, never by suppressing it. Once they pass, the docs nudge runs (see Packages).

Formatting is single quotes, semicolons, trailing commas and 100 columns (`.prettierrc.json`). Don't hand-format: let Prettier do it.

Finish a change only when `npm run check` passes.

## Git and GitHub

GitHub Issues is the only tracker; never Jira or anything else. All git and GitHub work goes through the `/git` skill (`.cursor/skills/git/`): one issue, one branch `<issue>-<kebab-name>` off `main`, one PR; or a stack of PRs, each based on the layer below (`stacks.md`), lower layers ending `Part of #123`. Commits are `type(scope): subject` with a `Refs: #123` footer, one scope each in build order; the PR title is the same header format, and its body ends with `Closes #123`. Stage named files only, push rewrites with `--force-with-lease` and only on draft PRs, merge with `--squash` (`gh stack merge <pr> --yes --squash` for a stack), cherry-pick only after the user writes "allow cherry-pick". A chat's first prompt names its issue (`#123`) or starts with `NO-ISSUE`. The git guard (`beforeShellExecution`) denies commands that break these; `.cursor/skills/git/conventions.md` has the formats with examples.
