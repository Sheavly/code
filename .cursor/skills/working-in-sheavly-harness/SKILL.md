---
name: working-in-sheavly-harness
description: Conventions and workflow for changing the @sheavly/harness agent loop (TypeScript, Node 24 ESM): layer boundaries, module folders and `<name>.<kind>.ts` file kinds, adding tools/providers/events, tests in __tests__, and the Prettier + ESLint + tsc + knip + jscpd quality gate enforced by Cursor hooks. Use when editing any code in this project, adding a tool, adapter or loop event, writing tests, or when a hook reports lint, format, type, dead-code or duplication failures.
---

# Working in @sheavly/harness

## Layers (imports only point down)

```
@sheavly/core  ←  providers, runtime  ←  tools  ←  loop  ←  demo.ts (host)
```

| Layer            | Holds                                                               | May import    |
| ---------------- | ------------------------------------------------------------------- | ------------- |
| `packages/core`  | `@sheavly/core`: contracts, `defineTool`/`runTool`, `defineAdapter` | zod only      |
| `src/providers/` | Adapters, registry, `ProviderSwitch`, Responses client              | core          |
| `src/runtime/`   | Stateful services: workspace sandbox, processes, tasks              | core          |
| `src/tools/`     | One folder per tool                                                 | core, runtime |
| `src/loop/`      | `streamAgent` / `runAgent`, events, queue, abort                    | core, runtime |
| `src/demo.ts`    | Host: reads env, wires everything, renders events                   | anything      |

ESLint enforces this (`LAYERS` in `eslint.config.js`). If an import is rejected, pass the dependency in as an option instead of moving the rule.

## Packages

Design docs live in `docs/` (overview, tools, hooks, sessions). When a feature lands, update its doc in the same change. The stop hook nudges you once when source files changed but the doc describing them didn't (`DOC_SOURCES` in `.cursor/hooks/docs.utils.mjs`); update the doc if what it says changed, otherwise just finish.

npm workspaces in `packages/`, consumed as TypeScript source by subpath (`import { defineTool } from '@sheavly/core/tool/tool.service'`); nothing is built.

- `packages/core`: what tools and providers are written against. It may not import the app (`rootDir` makes that a type error). A new contract shared by tools, providers and a future UI goes here.
- `packages/eslint-config`: `base.js` (the shared config), `file-kinds.js`, `rules/` (the `harness/*` rules, tested with RuleTester in `__tests__/`). A new convention is a rule here, used by every workspace.
- A new package: `npm init -y -w packages/<name>`, then `npm pkg set -w packages/<name> ...` (never hand-edit `package.json`), an `eslint.config.js` calling `baseConfig({ tsconfigRootDir: import.meta.dirname })`, and a `tsconfig.json` extending `../../tsconfig.base.json` with `rootDir: "src"`. Depend on it with `npm install <name>@0.0.0`.

## File structure

Each layer holds one folder per module; everything about a module lives in it. Every file is `<name>.<kind>.ts` in kebab-case (`harness/file-kind`):

```
src/tools/run-command/
  run-command.tool.ts        the tool (code only)
  run-command.types.ts       exported types only
  run-command.constants.ts   exported literal constants only
  run-command.utils.ts       pure helpers (no I/O, no services)
  __tests__/run-command.tool.test.ts
```

Kinds: `types`, `constants`, `utils`, `service`, `tool`, `adapter`, `errors`, `fake` (src/testing/), `test`. Policies (exports, max lines) are in `packages/eslint-config/src/file-kinds.js`; a genuinely new kind is added there.

- A code file never exports a type or a literal constant: move it to the module's `*.types.ts` / `*.constants.ts` (`harness/kind-contents`). Unexported local ones may stay.
- `*.types.ts` imports only with `import type`; derive schema types there with `z.infer<typeof xSchema>`.
- Module-level functions with more than one input (outside tests) take one destructured `params` object: `function f(params: { a: A; b: B }) { const { a, b } = params; }`.
- `type`, never `interface`. Named exports only. No re-exports (barrels) except `src/index.ts`, the package entry. Name caught errors `caughtError`.
- No deprecated APIs (`@typescript-eslint/no-deprecated`, in `.ts` and `.js`/`.mjs` alike): use the replacement the error names, never a workaround that hides the `@deprecated` tag.
- Import from the defining file (`../../runtime/tasks/tasks.service.js`) or a package subpath, never from `src/index.ts`.
- When a file hits its kind's line limit, split it by responsibility into another `<name>.<kind>.ts` in the same folder (as `stream-agent/` does with `turn.service.ts` and `sample.service.ts`).

## Adding things

**A tool**: create `src/tools/<name>/`, copying the shape of `tools/read-file/`. `defineTool` and the `Tool` types come from `@sheavly/core/tool/tool.service` / `tool/tool.types`.

- `<name>.tool.ts`: `create<Name>Tool(options)` returns `defineTool({ name, description, inputSchema, execute })`.
- `inputSchema` is a `z.object`. Never add a `description` field: the harness adds the model's call description itself and strips it before `execute`.
- `execute({ input, signal, context })` returns a string, or `{ content, change }` when it changed a file (`change` is a `FileChange` with path, before and after: emitted on `tool_result` for the UI's diff, never put in history). It throws `Error`s with clear messages (`runTool` turns them into error results). Pass `signal` to every async operation.
- All file access goes through `Workspace` (`resolveRead` / `resolveWrite`); writing tools use `resolveWritable` from `tools/files/files.service.ts`. Never read or write `.env*` files. Commands go through `runtime/process/process.service.ts` and the allow list.
- Wire the tool into `src/demo.ts`, and export it from `src/index.ts`.

**A sub-agent**: `createSubAgentTool({ sessions, tasks, provider, runAgent: runSession, tools, hooks? })` (`tools/sub-agent/`). Every run is a session in a `SessionRegistry` (`runtime/sessions/`): pass `session: { registry, ref }` to the loop, or it starts its own main session. Sub-agents nest at most `MAX_SESSION_DEPTH` (3), always under a running parent, and report their own status with `report_status`; a parent steers one with `message_agent` (the session inbox: `sessions.send`, delivered at the next model call). `sessions.stream()` is the SSE feed. See `docs/sessions.md`.

**A provider**: `src/providers/adapters/<name>.adapter.ts` with `defineAdapter({ kind, description, configSchema, create: ({ config, deps }) => ... })` (from `@sheavly/core/adapter/adapter.service`), then register it in `adapters.service.ts`. Core code doesn't change.

**A loop event**: add it to the `AgentEventBody` union in `loop/events/events.types.ts` and emit it through the `OrderedQueue`, never directly, so `seq` stays contiguous and in causal order. Render it in `demo.ts`.

**A hook**: `defineHook({ name, sessionStart?, beforeTurn?, aroundToolCall?, afterTurn?, onError? })` from `@sheavly/core/hook/hook.service`, passed in the loop's `hooks` option (order matters). `sessionStart` (once per run) and `beforeTurn` add context with `addContext` (a user message kept in history, emitted as `context_added`); `beforeTurn` can also `addInstructions` (system instructions for that model call only, appended to the run's `instructions` option, never in history; the built-in `createAgentsMdHook` in `runtime/agents-md/` uses it); `aroundToolCall` calls `next()` to continue, or returns a result to block; `afterTurn` sees the turn's reply with tool results in history; `onError` is told when the run fails (its own errors are ignored, the run's error is rethrown). A new hook point is a new optional handler on `Hook`, added to `HANDLERS` in `hook.utils.ts` and run from `loop/hooks/hooks.service.ts`.

**A project hook** (`.sheavly/`): listed in `.sheavly/hooks.json`, loaded by `runtime/project-hooks/` with a native `import()`, its default export validated with zod. A new handler on `Hook` must also be added to `hookExportSchema` in `project-hooks.utils.ts` (a `satisfies` check fails the typecheck if it is missing). Tests write real temp projects; `vitest.config.ts` keeps Vite away from `.sheavly` files so Node's own ESM/CommonJS/TypeScript rules apply.

## Rules

- All external input is validated with zod (tool inputs, adapter config, env).
- Interrupts must leave history valid: every tool call gets a result message, even a placeholder.
- Keep files under ~250 lines and functions under the cognitive-complexity limit. Split into small helpers rather than fighting the rule.
- No `eslint-disable` comments (`noInlineConfig`). A justified exception is a `files:` override in `eslint.config.js`, with a reason.
- Fakes live only in `src/testing/` (`fake-fetch.fake.ts`, `scripted-provider.fake.ts`). No mock data in dev or prod code.
- Never edit `package.json` by hand: use `npm install -D <pkg>` / `npm pkg set`.
- Don't run `src/demo.ts` unless asked: it calls a paid model API.

## Tests

- Tests go in `<module>/__tests__/<name>.<kind>.test.ts`. Anywhere else, ESLint fails it and Vitest never runs it.
- Use `scriptedProvider` / `fakeFetch` and temporary directories. Tests never touch the network.
- Cover the guard paths too (rejections, aborts, ordering), not just the happy path.

## Quality gate

```bash
npm run check      # tsc --noEmit → eslint . → prettier --check . → knip → jscpd → vitest run
npm run lint:fix   # ESLint auto-fixes, then Prettier (in that order)
npm run format     # Prettier only
```

knip (unused files, exports, types, dependencies; `knip.json`) and jscpd (copied code; `.jscpd.json`) fail only on findings not in `knip-baseline.json` / `.jscpd-baseline.json`. Remove dead code; reuse or extract duplicated code. Never hand-edit the baselines or add `jscpd:ignore` comments; after fixing baselined debt run `npm run knip:baseline` / `npm run jscpd:baseline` (prune-only: they never add entries). After deleting dead code, re-run `npm run knip`: removing one export often leaves what it used unused. `npx knip --fix --fix-type exports,types` is allowed; never the `dependencies`/`files` fix types. Root tooling scripts live in `scripts/` (plain Node ESM, tests in `scripts/__tests__/`).

Cursor hooks (`.cursor/hooks.json`) run this automatically:

- **After each Write**, the edited file is formatted with Prettier, then linted. If the hook says "Prettier reformatted the file", re-read the file before editing it again, since old `old_string` text may no longer match.
- **On stop**, typecheck, Prettier check, ESLint, knip and jscpd run. A failure comes back as a follow-up message (up to 3 rounds): fix the cause in code, never by suppressing it. Once they pass, the docs nudge runs (see Packages).

Formatting is single quotes, semicolons, trailing commas and 100 columns (`.prettierrc.json`). Don't hand-format: let Prettier do it.

Finish a change only when `npm run check` passes.

## Git and GitHub

GitHub Issues is the only tracker; never Jira or anything else. All git and GitHub work goes through the `/git` skill (`.cursor/skills/git/`): one issue, one branch `<issue>-<kebab-name>` off `main`, one PR; or a stack of PRs, each based on the layer below (`stacks.md`), lower layers ending `Part of #123`. Commits are `type(scope): subject` with a `Refs: #123` footer, one scope each in build order; the PR title is the same header format, and its body ends with `Closes #123`. Stage named files only, push rewrites with `--force-with-lease` and only on draft PRs, merge with `--squash` (`gh stack merge <pr> --yes --squash` for a stack), cherry-pick only after the user writes "allow cherry-pick". A chat's first prompt names its issue (`#123`) or starts with `NO-ISSUE`. The git guard (`beforeShellExecution`) denies commands that break these; `.cursor/skills/git/conventions.md` has the formats with examples.
