# @sheavly/harness

A TypeScript agent loop with pluggable model adapters (OpenAI, Azure, Astra).

Design notes for building on the harness are in [docs/](docs/README.md).

## Requirements

- Node 24+
- An OpenAI API key (needed for the default backend, GPT-6.1 Sol)

## 1. Install

```bash
cd ~/projects/coding-harness
npm install
```

## 2. Add your API key

Keys are read from environment variables. For local dev, put them in `.env` in the project root.
`.env` is in `.gitignore`, so it is never committed.

If you don't have a `.env` yet:

```bash
cp .env.example .env
```

If you already have one, just add this line to it:

```bash
OPENAI_API_KEY=sk-...your key...
```

Optional: set `MODEL=...` to use a different model. The default is `gpt-6.1-sol`.

In production, set `OPENAI_API_KEY` as a real environment variable instead of using `.env`.

## 3. Run the tests (free, no network)

```bash
npm test            # run once
npm run test:watch  # re-run on save
npm run typecheck   # type errors only
npm run lint        # ESLint (see "Code quality" below)
npm run format      # Prettier: format everything
npm run check       # the full quality gate: typecheck + lint + format check + knip + jscpd + tests
```

The tests use a fake `fetch` and scripted providers, so they never call a real API.

## 4. First real model call (costs money)

### OpenAI (default)

```bash
npx tsx src/demo.ts "Say hello in five words"
```

### Azure

Add to `.env` (your endpoint URL without `/responses` and without the `?api-version=` part):

```bash
ADAPTER=azure
AZURE_OPENAI_API_KEY=...your azure key...
AZURE_OPENAI_BASE_URL=https://<resource>.cognitiveservices.azure.com/openai
AZURE_OPENAI_API_VERSION=2025-04-01-preview
AZURE_OPENAI_DEPLOYMENT=gpt-6.1-sol
```

Then run the same command. `AZURE_OPENAI_DEPLOYMENT` must match the deployment name in the Azure portal.

### What it does

This sends one prompt to OpenAI / `gpt-6.1-sol` through the adapter registry and streams the reply.
A short prompt costs a fraction of a cent. See `src/demo.ts`.

If the key is missing you'll get a zod error that says `Set OPENAI_API_KEY in .env or your shell`.
A `Responses API error 401` means the key is wrong.

For stored prompts, saved runs and stepping through what happened, use the workbook
(`npm run workbook -- list`, see [workbook/README.md](workbook/README.md)).

Demo settings, as environment variables (see the top of `src/demo.ts`):

- `WORKSPACE_ROOT=<dir>`: where the file tools, AGENTS.md and `.sheavly/` hooks are read from.
- `SHOW_MODEL_CALLS=true`: prints every model call (main session and sub-agents) with its tools,
  system prompt and latest user message.
- `SESSIONS_SSE_LOG=<file>`: writes the session server-sent event stream (what a UI would read)
  to a file.

## Using other backends

Every adapter is created from the registry with a config object that is checked by zod:

```ts
import { createDefaultRegistry, ProviderSwitch } from './src/index.js';

const registry = createDefaultRegistry();

const providers = new ProviderSwitch()
  .add('sol', registry.create('openai', { apiKey: process.env.OPENAI_API_KEY }))
  .add(
    'azure',
    registry.create('azure', {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseUrl: 'https://<resource>.openai.azure.com/openai/v1',
      deployment: '<your-deployment-name>',
    }),
  )
  .add(
    'astra',
    registry.create('astra', {
      apiKey: process.env.ASTRA_API_KEY,
      model: 'openai/gpt-6-luna',
    }),
  );

providers.use('azure'); // swap at runtime; applies from the next model call
```

Pass `providers` as the `provider` option of `runAgent`.

## Project hooks (`.sheavly/`)

A project customizes the harness with hooks in `.sheavly/`, laid out like `.cursor/`:

```
.sheavly/
  hooks.json          the only required file: which hooks run, in order
  hooks/
    audit.js          JavaScript or TypeScript (.js .mjs .cjs .ts .mts .cts), ESM or CommonJS
```

```json
{
  "version": 1,
  "hooks": [{ "path": "hooks/audit.js" }, { "path": "hooks/x.ts", "enabled": false }]
}
```

A hook file exports the hook as its default (`export default { ... }` or `module.exports = { ... }`):

```js
export default {
  name: 'audit',
  aroundToolCall: async ({ call, next }) => next(), // also: sessionStart, beforeTurn, afterTurn, onError
};
```

- No tsconfig or package.json is needed. For types, `import type { Hook } from '@sheavly/core/hook/hook.types'`
  in TypeScript, or `/** @type {import('@sheavly/core/hook/hook.types').Hook} */` in JavaScript.
- Node runs TypeScript by removing the types: no `enum`, `namespace` or parameter properties.
- `.js` / `.ts` follow your package.json `"type"`. A hook in the other module format fails with
  a message to rename it to `.cjs` / `.cts` or `.mjs` / `.mts`, which load the same everywhere.
- `loadProjectHooks({ root })` loads them once at startup; pass them after your own hooks
  (`hooks: [...hostHooks, ...projectHooks]`), so yours wrap the project's.

## Adding a new provider

Write an adapter in `src/providers/adapters/<name>.adapter.ts` with
`defineAdapter({ kind, description, configSchema, create })` (from `@sheavly/core/adapter/adapter.service`)
and call `registry.register(myAdapter)`.
Nothing in the core needs to change.

## Project layout

Every layer holds one folder per module, and every file is `<name>.<kind>.ts`. Imports only point
"down" the layers (`LAYERS` in `eslint.config.js`). Code shared beyond the app lives in workspace
packages (npm workspaces):

```
packages/
  core/            @sheavly/core: contracts (Message, ToolCall, Provider, ...), the tool
                   definition (defineTool, runTool) and the adapter definition (defineAdapter).
                   What tools and providers are written against.
  eslint-config/   @sheavly/eslint-config: the shared ESLint config and harness/* rules
```

`core` follows the app's layout, one folder per module:

```
packages/core/src/
  message/         Message, ToolCall, ReasoningItem, StreamEvent (conversation history)
  provider/        Provider, ProviderRequest, ToolDefinition (the backend contract)
  tool/            Tool types, defineTool, runTool, describeCall
  adapter/         Adapter types, defineAdapter
  hook/            Hook types (sessionStart, beforeTurn, aroundToolCall, afterTurn, onError), defineHook
```

Packages are consumed as TypeScript source (`exports` points at `src/*.ts`; nothing is built) and
imported by subpath: `import { defineTool } from '@sheavly/core/tool/tool.service'`. A package can
only import what its own `package.json` depends on; `core` can't reach into the app (its `rootDir`
makes that a type error).

The app's layers:

```
@sheavly/core  ←  providers, runtime  ←  tools  ←  loop  ←  demo.ts (host)
```

```
src/
  providers/                    model backends; only depend on @sheavly/core
    registry/                   AdapterRegistry
    adapters/                   openai (default), azure, astra: one *.adapter.ts each
    responses/                  shared Responses API client, SSE reader
    switch/                     ProviderSwitch (runtime swapping)
  runtime/                      stateful services; no loop, tools or providers
    workspace/                  sandbox root and path checks
    process/                    spawning, process-group kill, secret scrubbing
    tasks/                      background task registry
    project-hooks/              loads .sheavly/hooks.json and its hook files
  tools/                        one folder per tool; no loop or providers
    read-file/  write-file/  edit-file/  files/ (shared)  run-command/  tasks/
  loop/                         the agent loop; knows the core contracts only
    stream-agent/               streamAgent / runAgent, one turn, one model call
    events/  queue/  abort/  hooks/
  testing/                      test-only fakes (*.fake.ts)
  demo.ts                       host: reads env, wires everything, renders events
  index.ts                      the package entry: the one file that re-exports
```

A tool folder, for example, holds everything about that tool:

```
tools/run-command/
  run-command.tool.ts           createRunCommandTool (defineTool)
  run-command.types.ts          RunCommandOptions
  run-command.constants.ts      DEFAULT_COMMAND_TIMEOUT_MS
  run-command.utils.ts          checkAllowed, formatResult (pure)
  allow-list.constants.ts  allow-list.types.ts  allow-list.utils.ts
  __tests__/                    run-command.tool.test.ts, allow-list.utils.test.ts
```

## Code quality

`npm run check` is the quality gate: `tsc --noEmit`, then ESLint, then `prettier --check`, then
knip and jscpd, then the tests.

### Dead code and duplication (knip, jscpd)

- **knip** (`knip.json`) finds unused files, exports, types and dependencies across every
  workspace. Packages are checked at their boundary too (`includeEntryExports`), so a
  `@sheavly/core` export nothing uses fails; the app's `src/index.ts` is the public API and is
  exempt. `npm run knip`.
- **jscpd** (`.jscpd.json`) finds copied code (50+ tokens over 5+ lines) in `.ts` and `.js`/`.mjs`.
  `npm run jscpd` goes through `scripts/jscpd-runner.mjs`, which fails when `.jscpd.json` is
  missing or unreadable instead of letting jscpd silently scan with its defaults.
- **Baselines.** Existing findings are recorded in `knip-baseline.json` (a preprocessor,
  `scripts/knip-baseline.mjs`, drops them from the report) and `.jscpd-baseline.json`, so only
  new dead code or duplication fails. They may only shrink: after fixing baselined debt run
  `npm run knip:baseline` / `npm run jscpd:baseline`, which drop fixed entries and never add new
  ones (a new finding fails, to be fixed in code). Never hand-edit them or add `jscpd:ignore`.
- Remove dead code by hand, or with `npx knip --fix --fix-type exports,types`; never knip's
  `dependencies`/`files` fix types, which edit `package.json` and delete files. Change
  dependencies with `npm install|uninstall`.

### Prettier

`.prettierrc.json`: 100 columns, single
quotes, semicolons, trailing commas, 2-space indent, LF line endings. Prettier owns formatting;
`eslint-config-prettier` turns off every ESLint rule that would disagree with it. `npm run lint:fix`
runs ESLint's fixes first and Prettier after, since a fix (like adding braces) can need formatting.

### File structure (custom rules)

Everything below lives in `packages/eslint-config/src/`: kinds and their policies in `file-kinds.js`,
the rules in `rules/` (registered in `plugin.js`, tested in `__tests__/`), and the config every
workspace uses in `base.js`. Each workspace's `eslint.config.js` is
`baseConfig({ tsconfigRootDir: import.meta.dirname })` plus its own boundaries; `npm run lint` at the
root lints every workspace with its own config. Each convention is its own rule ID, so an override
switches off exactly one (e.g. `harness/no-barrel` is off for `src/index.ts`).

| Kind        | Holds                                   | May export                   | Max lines |
| ----------- | --------------------------------------- | ---------------------------- | --------- |
| `types`     | shared shapes                           | only types (imports `type`s) | 300       |
| `constants` | literal values, `as const`              | only literals                | 300       |
| `utils`     | pure helpers: no I/O, no services       | code                         | none      |
| `service`   | stateful or I/O code, classes, the loop | code                         | 300       |
| `tool`      | one agent tool (`defineTool`)           | code                         | 150       |
| `adapter`   | one model backend (`defineAdapter`)     | code                         | 150       |
| `errors`    | error classes                           | code                         | 150       |
| `fake`      | test-only fakes in `src/testing/`       | code                         | 300       |
| `test`      | Vitest files in `__tests__/`            | code                         | 500       |

- `harness/file-kind`: every module file is named `<name>.<kind>.ts` (kebab-case, known kind);
  tests only in `__tests__/`, and only tests there.
- `harness/kind-contents`: code files export no types and no literal constants; those go in the
  module's `*.types.ts` / `*.constants.ts`. Unexported local types and values are fine.
- `harness/utils-imports`: `*.utils.ts` imports no I/O modules and no services/tools/adapters.
- **Params object** (`harness/params-object`): module-level functions with more than one input take one destructured
  `params` object (`f(params: { a; b }) { const { a, b } = params; }`). Class methods and inline
  callbacks are exempt, since their caller fixes the signature; so are test files.
- **`type`, not `interface`**; **named exports only** (`harness/no-default-export`); **no barrels** (`harness/no-barrel`,
  re-exports only in `src/index.ts`); env only in hosts (`harness/no-process-env`); caught errors are named `caughtError`.

### ESLint

`eslint.config.js` is strict and type-aware (typescript-eslint `strictTypeChecked`), with
readability rules: cognitive complexity, max depth/nesting, early
returns, no nested ternaries, blank lines between steps (auto-fixed with `npm run lint:fix`).

- **Tests live in `__tests__/`** next to the code they test (`src/tools/__tests__/read-file.test.ts`).
  ESLint rejects a `*.test.ts` anywhere else, and Vitest only runs `src/**/__tests__/**/*.test.ts`.
- **No inline escape hatches.** `eslint-disable` comments are rejected
  (`noInlineConfig`). An exception goes in a `files:` override in the config, with a reason.
- **No baseline.** The codebase is lint-clean. If a new rule is ever introduced on existing code,
  `npx eslint . --suppress-all` records the current violations in `eslint-suppressions.json`
  (pay them down when touching a file, then `npm run lint:prune`). Never suppress new code.

### Cursor hooks

`.cursor/hooks.json` runs the same checks automatically while the Cursor agent works.

| Event                           | Script                                 | What it does                                                                                                                                                                                                                                                     |
| ------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beforeSubmitPrompt`            | `.cursor/hooks/require-issue.mjs`      | A chat's first prompt must name its GitHub issue (`#123`, or check out its branch); `NO-ISSUE` opts out, Ask mode is exempt. Remembers the issues named (several for a stack), and "allow cherry-pick", per chat. See "Git workflow".                            |
| `beforeShellExecution`          | `.cursor/hooks/guard-git-workflow.mjs` | Denies agent git/gh commands that break the git workflow: a branch not `<issue>-<name>` for one of the chat's issues, `git add -A`/`.`, `--force`, a non-squash merge, an unapproved cherry-pick, a commit message off the format, interactive `gh stack` forms. |
| `postToolUse` (matcher `Write`) | `.cursor/hooks/lint-edited-file.mjs`   | Formats the file the agent just edited with Prettier, then lints it, and returns notes and problems as `additional_context`, so they're fixed right away. Advisory: never blocks the edit.                                                                       |
| `stop` (`loop_limit: 3`)        | `.cursor/hooks/check-on-stop.mjs`      | When a turn finishes (`status: "completed"`), runs typecheck + Prettier check + ESLint + knip + jscpd (new jscpd clones only). On failure it returns a `followup_message` with the report, so the agent keeps fixing, at most 3 extra rounds.                    |

Shared helpers (stdin/stdout JSON, edited-path lookup, running local binaries) are in
`.cursor/hooks/hooks.utils.mjs`. Cursor reloads `hooks.json` on save; check the **Hooks**
output channel if a hook doesn't fire. To try one by hand:

```bash
echo '{"tool_input":{"file_path":"packages/core/src/tool/tool.service.ts"}}' | node .cursor/hooks/lint-edited-file.mjs
echo '{"status":"completed"}' | node .cursor/hooks/check-on-stop.mjs
```

Both print `{}` when everything passes.

## Git workflow

GitHub is the only tracker: work is a GitHub issue in this repo, and nothing uses Jira or any other
tool. All git and GitHub work goes through the `/git` skill (`.cursor/skills/git/`), for people as
well as agents; its `conventions.md` has the formats with good and bad examples.

- **One issue, one branch, one PR**, based on `main`. Work too big for one PR is split into
  sub-issues with their own PRs, or, when the parts depend on each other, into a **stack of PRs**:
  each layer is a normal issue branch and PR based on the layer below, the bottom one on `main`
  (`.cursor/skills/git/stacks.md`; `gh stack` optional). Lower layers end with `Part of #123`
  instead of `Closes #123`, so the issue closes when the top layer merges.
- **Branches:** `<issue>-<kebab-name>` (`123-provider-switch`), GitHub's own form:
  `gh issue develop 123 --name 123-provider-switch --base main --checkout` links it to the issue.
- **Commits:** one scope each, in the order the work was built, so a reviewer reads the PR commit
  by commit. `type(scope): subject` (types `feat fix refactor perf test docs build ci chore
revert`; the scope is a package or `src/` folder, or left out for root tooling; imperative,
  lowercase, no full stop, header at most 72 characters), an optional body explaining why, and a
  `Refs: #123` footer.
- **PRs:** opened as drafts. Title `type(scope): subject`, with no issue number; it becomes the
  squashed commit on `main`. The body (`.github/pull_request_template.md`) has Why, Commits, What
  changes, How to review and Test plan, and ends with `Closes #123`, which links the PR to the
  issue and closes the issue on merge.
- **Issues** have a type (`Task`, `Bug`, `Feature`, set by the forms in `.github/ISSUE_TEMPLATE/`),
  are split into sub-issues when they're bigger than one PR, and record order as "blocked by"
  dependencies. Labels only for what types can't say, never for status or priority
  (`.cursor/skills/git/issues.md`).
- **Status** is read from GitHub: open, blocked, a branch or draft PR (in progress), a ready PR (in
  review), closed by the merge (done). A GitHub Project board, if used, mirrors that.
- **Rewriting:** while the PR is a draft, fixes are folded into the commit they belong to and
  pushed with `--force-with-lease`; once it's ready for review, fixes are new commits on top.
- **Merging:** `gh pr merge <n> --squash` (`gh stack merge <pr> --yes --squash` for a stack).
  Every push of new work is first reviewed by Bugbot and a security review.
- **Enforced:** the issue gate and the git guard (hooks above) for agents; the `Git format`
  workflow (`.github/workflows/git-format.yml`, running `scripts/check-git-format.mjs`) for every
  PR's title, branch, base (`main` or an issue branch, for stacks) and `Closes #`/`Part of #`
  line. Dependabot's PRs are the one kind without an issue.
- **Repo settings** (once, by a person; `.cursor/skills/git/setup.md`): squash merging only,
  defaulting to the PR title; branch protection on `main` requiring the `Git format` check.
