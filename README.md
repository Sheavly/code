# @sheavly/harness

A TypeScript agent loop with pluggable model adapters (OpenAI, Azure).

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
npm run check       # the full quality gate: typecheck + lint + format check + knip + jscpd + layout + tests
```

`test`, `typecheck`, `lint` and `check` run through Turborepo, so a rerun reuses every result whose
inputs didn't change (see "Code quality").

The tests use a fake `fetch` and scripted providers, so they never call a real API.

## 4. First real model call (costs money)

### OpenAI (default)

```bash
npm run demo -- "Say hello in five words"
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
A short prompt costs a fraction of a cent. See `apps/terminal/src/demo.ts`.

If the key is missing you'll get a zod error that says `Set OPENAI_API_KEY in .env or your shell`.
A `Responses API error 401` means the key is wrong.

For stored prompts, saved runs and stepping through what happened, use the workbook
(`npm run workbook -- list`, see [workbook/README.md](workbook/README.md)).

Demo settings, as environment variables (see the top of `apps/terminal/src/demo.ts`):

- `WORKSPACE_ROOT=<dir>`: where the file tools, AGENTS.md and `.sheavly/` hooks are read from.
- `SHOW_MODEL_CALLS=true`: prints every model call (main session and sub-agents) with its tools,
  system prompt and latest user message.
- `SESSIONS_SSE_LOG=<file>`: writes the session server-sent event stream (what a UI would read)
  to a file.
- `SHEAVLY_TRUST_FILE=<file>`: where trusted workspaces are remembered (default
  `~/.config/sheavly/trusted-workspaces.json`). The `--trust` flag trusts the workspace's
  `.sheavly/` hooks: `npm run demo -- --trust "your prompt"`.

## Using other backends

Every adapter is created from the registry with a config object that is checked by zod:

```ts
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { ProviderSwitch } from '@sheavly/providers/switch/switch.service';

const registry = createDefaultRegistry();

const providers = new ProviderSwitch()
  .add(
    'sol',
    registry.create('openai', { apiKey: process.env.OPENAI_API_KEY, model: 'gpt-6.1-sol' }),
  )
  .add(
    'azure',
    registry.create('azure', {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseUrl: 'https://<resource>.openai.azure.com/openai/v1',
      deployment: '<your-deployment-name>',
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
- `loadProjectHooks({ root, trust })` loads them once at startup; pass them after your own hooks
  (`hooks: [...hostHooks, ...projectHooks.hooks]`), so yours wrap the project's.
- **Only in a trusted workspace.** Hook files are code from the repo, so the harness loads none
  until you trust the workspace: run the demo once with `--trust`. It's remembered (outside the
  repo, in `~/.config/sheavly/trusted-workspaces.json`, or `SHEAVLY_TRUST_FILE`) until anything in
  `.sheavly/` changes; then the hooks are skipped again until you review and trust it again. A
  hook may import only files inside `.sheavly/` and Node built-ins, since nothing else is covered
  by that trust. See [docs/hooks.md](docs/hooks.md#workspace-trust).

## Adding a new provider

Providers are their own package, `@sheavly/providers` (`packages/providers/`); its
[README](packages/providers/README.md) describes adding one. In short:

- A backend that speaks the OpenAI Responses API is one folder with a `<name>.adapter.ts` calling
  `defineResponsesAdapter({ kind, description, configSchema, toEndpoint })`: a pure map from its
  config to a base URL, model and headers. Streaming, tool calls and reasoning are shared.
- Another protocol (Anthropic Messages, Google Gemini, Chat Completions) gets its own protocol
  folder next to `responses/`, with backends on it. Only the `Provider` contract is shared.
- Register it with `registry.register(myAdapter)`, or add it to `createDefaultRegistry`.

Adapters have no default model: the caller picks it (the hosts' default is `DEFAULT_MODEL` in
`packages/host/src/host/host.constants.ts`). Nothing in the core needs to change.

## Project layout

The harness is npm workspaces: libraries in `packages/`, front ends in `apps/`. Imports only point
down (`harness/imports`, read from each workspace's `package.json`):

```
@sheavly/protocol  ←  @sheavly/core  ←  @sheavly/providers, runtime  ←  tools  ←  loop  ←  host  ←  workspace  ←  coding  ←  terminal-ui  ←  apps
```

```
packages/
  protocol/        @sheavly/protocol: the wire contract a UI talks to (events, updates, answers), as zod schemas
  core/            @sheavly/core: contracts (Message, Provider, Tool, Hook), defineTool, runTool, defineAdapter
  providers/       @sheavly/providers: model backends. responses/ (the Responses protocol),
                   openai/ and azure/ (backends on it), registry/, switch/
  runtime/         @sheavly/runtime: sessions, background tasks, approvals
  tools/           @sheavly/tools: the generic tools (sub-agents, task status)
  loop/            @sheavly/loop: streamAgent / runAgent, events, queue, abort, hooks
  host/            @sheavly/host: createHarness (generic) and the model from env; no UI
  workspace/       @sheavly/workspace (coding): path confinement, processes, trust, file locks,
                   .sheavly/ hooks, AGENTS.md
  coding/          @sheavly/coding (coding): the file tools, run_command, createCodingHarness
  terminal-ui/     @sheavly/terminal-ui (coding): the Renderer the terminal front ends print with
  testing/         @sheavly/testing: test-only fakes (scripted providers, fake fetch)
  eslint-config/   @sheavly/eslint-config: the shared ESLint config and harness/* rules
apps/
  terminal/        @sheavly/terminal: the demo (npm run demo)
  workbook/        @sheavly/workbook: stored prompts and saved runs (npm run workbook)
  vscode/          the VS Code extension, a README until it is built
```

Every workspace holds one folder per module, and every file is `<name>.<kind>.ts`:

```
packages/core/src/
  message/         Message, ToolCall, ReasoningItem, StreamEvent (conversation history)
  provider/        Provider, ProviderRequest, ToolDefinition (the backend contract)
  tool/            Tool types, defineTool, runTool, describeCall
  adapter/         Adapter types, defineAdapter
  hook/            Hook types (sessionStart, beforeTurn, aroundToolCall, afterTurn, onError), defineHook
```

Workspaces are built: each has a `dist/` for plain Node, and `npm run build` compiles them in
dependency order through turbo. Dev, tests and typecheck read their source instead, through the
`@sheavly/source` export condition, so nothing is built first (see
[docs/overview.md](docs/overview.md#packages)). They're imported by subpath:
`import { defineTool } from '@sheavly/core/tool/tool.utils'`. A workspace can only import what its
own `package.json` depends on, and nothing imports an app.

A tool folder, for example, holds everything about that tool:

```
packages/coding/src/run-command/
  run-command.tool.ts           createRunCommandTool (defineTool)
  run-command.types.ts          RunCommandOptions
  run-command.constants.ts      DEFAULT_COMMAND_TIMEOUT_MS
  run-command.utils.ts          checkAllowed, formatResult (pure)
  arguments.helper.ts           findConcerns, confirmArguments (workspace checks: I/O)
  allow-list.constants.ts  allow-list.types.ts  allow-list.utils.ts
  __tests__/                    run-command.tool.test.ts, allow-list.utils.test.ts
```

## Code quality

`npm run check` is the quality gate: typecheck, ESLint, `prettier --check`, knip, jscpd, the
layout check and the tests. The `Check` workflow (`.github/workflows/check.yml`) runs it on every PR.

### The pipeline (Turborepo)

`npm run check` runs every task in `turbo.json`, along the dependency graph npm workspaces define:

- **Per workspace:** every package has its own `typecheck`, `lint` and `test` scripts, which check
  only its files. Each runs after the same task in the packages it imports (`^typecheck`, …).
- **The root** (`//#` tasks): `lint:root` and `test:root` check `scripts/`, `.cursor/hooks/` and the root configs; `format:check`, `knip` and `jscpd` check the
  whole repo.
- **Cache:** each result is cached in `.turbo/cache` (per checkout, so worktrees never share one)
  by its inputs, so a second `npm run check` with no changes runs nothing. A change in
  `turbo.json`, `tsconfig.base.json`, `.prettierrc.json`, `vitest.config.ts`,
  `packages/eslint-config` or the lockfile invalidates every result.
- **Affected only:** `npm run check:affected` runs the workspace tasks only for workspaces changed
  since `main` (committed or not) and those that depend on them, then the repo-wide checks in full.
  CI runs it on PRs and restores `.turbo/cache` from `main`'s last run; the stop hook runs the
  affected typecheck and lint.

```bash
npx turbo run test --filter=@sheavly/providers   # one workspace's task (and what it imports)
npm run test -w @sheavly/providers               # the same, without turbo
npm run check -- --force                         # bypass the cache: rerun everything
npx turbo run lint --dry                         # what would run, and what is cached
```

The harness is a backend: `harness/no-terminal-io` (in `@sheavly/eslint-config`, so every
workspace gets it) fails `node:readline`, `node:tty` and `process.stdin/stdout/stderr` in
every package. Only an app (`apps/*`) may use them, print or read env: `baseConfig` reads that from
where the workspace is, so a package can't opt in. A new UI is a new app, made only when its issue
asks for one.

### Workspace layout (`npm run layout`)

A new workspace comes from the scaffold, never by hand:

```bash
npm run new -- package <name> --domain <generic|coding|tooling> --description "…" [--depends-on core,protocol]
npm run new -- app <name> --domain <generic|coding|tooling> --description "…" [--depends-on …]
```

It checks each `--depends-on` against the graph first and refuses one it doesn't allow (an app,
coding from generic, a tooling workspace), then creates `packages/<name>` or `apps/<name>` through
`npm init -w` and `npm pkg set` (adding `apps/*` to the root `workspaces` the first time), with its
`eslint.config.js`, `tsconfig.json`, `tsconfig.build.json`, a README and a first test. An allowed
dependency is installed with its first import (the scaffold prints the `npm install` command):
installed earlier, nothing would import it and knip would fail. The new workspace passes
`npm run check` as it is.

The layout is read from the workspaces, never listed by hand: which workspaces exist from the
root `package.json` `workspaces`, package or app from the folder (`packages/*`, `apps/*`), the graph from each workspace's own `dependencies` (`devDependencies` for its
tests), and its domain from its `sheavly` field (`npm pkg set sheavly.domain=<generic|coding|tooling>`).
Only `NOT_SOURCE` (reviewed exceptions) is written in `packages/eslint-config/src/layout.js`, on
purpose.

`scripts/check-layout.mjs` holds the workspaces to it: each has a domain, is named
`@sheavly/<folder>`, depends on no app, a generic one on
no coding one (its tests neither), and on tooling or test-only ones only as dev dependencies
(tests may use any workspace below, to drive the real code with); each has an
`eslint.config.js` calling `baseConfig` and a `tsconfig.json` extending `tsconfig.base.json` with
`rootDir: "src"`. TypeScript outside a workspace's `src/` fails, apart from what `NOT_SOURCE`
lists with a reason. knip finds the workspaces itself, so `knip.json` lists only the root's
settings. The imports themselves are `harness/imports`.

### Dead code and duplication (knip, jscpd)

- **knip** (`knip.json`) finds unused files, exports, types and dependencies across every
  workspace. Packages are checked at their boundary too (`includeEntryExports`), so a
  `@sheavly/core` export nothing uses fails. `npm run knip`.
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

`.prettierrc.json`: 100 columns, single quotes, semicolons, trailing commas, 2-space indent, LF
line endings. Prettier owns formatting; `eslint-config-prettier` turns off every ESLint rule that
would disagree with it. `npm run lint:fix` runs ESLint's fixes first and Prettier after, since a
fix (like adding braces) can need formatting.

### File structure (custom rules)

Everything below lives in `packages/eslint-config/src/`: kinds and their policies in `file-kinds.js`,
the rules in `rules/` (registered in `plugin.js`, tested in `__tests__/`), and the config every
workspace uses in `base.js`. Each workspace's `eslint.config.js` is
`baseConfig({ tsconfigRootDir: import.meta.dirname })` plus its own boundaries; `npm run lint` at the
root lints every workspace with its own config. Each convention is its own rule ID, so an override
switches off exactly one, on the files it is for, with a reason.

| Kind        | Holds                                                    | May export                   | Max lines |
| ----------- | -------------------------------------------------------- | ---------------------------- | --------- |
| `types`     | shared shapes                                            | only types (imports `type`s) | 300       |
| `constants` | literal values, `as const`                               | only literals                | 300       |
| `utils`     | pure helpers: no I/O, no services                        | code                         | none      |
| `validator` | zod schemas for external input, `parse*` functions; pure | code, schemas                | 300       |
| `helper`    | stateless functions; may do I/O, call services           | code, no classes             | 300       |
| `service`   | code that owns state                                     | code, at least one class     | 300       |
| `tool`      | one agent tool (`defineTool`)                            | code                         | 150       |
| `adapter`   | one model backend (`defineAdapter`)                      | code                         | 150       |
| `errors`    | error classes                                            | code                         | 150       |
| `fake`      | test-only fakes in a `testing/` folder                   | code                         | 300       |
| `test`      | Vitest files in `__tests__/`                             | code                         | 500       |

- `harness/file-kind`: every module file is named `<name>.<kind>.ts` (kebab-case, known kind);
  tests only in `__tests__/`, and only tests there.
- `harness/kind-contents`: code files export no types and no literal constants; those go in the
  module's `*.types.ts` / `*.constants.ts`. A `*.service.ts` exports a class, a `*.helper.ts`
  none, and only a `*.validator.ts` exports zod schemas. Unexported local types, values and
  schemas are fine.
- `harness/pure-imports`: `*.utils.ts` and `*.validator.ts` import no I/O modules and no services, helpers, tools or adapters.
- `harness/layout` and `harness/imports`: every workspace holds together as the layout reads it
  from the workspaces (a domain, named after its folder, no app or coding-from-generic edge), and
  imports follow the graph: another workspace only if `package.json` depends on it (dev
  dependencies for tests), test-only workspaces only from tests and fakes, no relative import
  across workspace roots.
- `harness/single-definition`: each `*.types.ts` (in every workspace's `src/`,
  outside tests and fakes) owns the type names it exports. The same name declared anywhere else,
  exported or not (another folder, another package, a second types file of the same package), or
  re-exported from a file that isn't its owner (`export type { X } from`, `export type * from`),
  fails with where the original lives, how to import it and how to change it (its schema, for a
  protocol type). Owners are read from the workspace on disk, so a new package, folder or type is
  covered without editing the rule.
- **Params object** (`harness/params-object`): module-level functions with more than one input take one destructured
  `params` object (`f(params: { a; b }) { const { a, b } = params; }`). Class methods and inline
  callbacks are exempt, since their caller fixes the signature; so are test files.
- **`type`, not `interface`**; **named exports only** (`harness/no-default-export`); **no barrels** (`harness/no-barrel`,
  import from the defining file); env only in apps, which pass `process.env` in (`harness/no-process-env`, checked on every package file); caught errors are named `caughtError`.
- **Fail loudly** (`harness/no-silent-catch`, every workspace plus `.cursor/hooks/` and `scripts/`):
  a `catch` or `.catch()` must use what it caught: rethrow it, check its `code` or class and
  handle only what it expects, or pass it on as `cause`. Turning every error into a default
  (`[]`, `undefined`, a fresh error without the cause) fails.
- **Typed errors only** (`harness/no-raw-error`): source never builds a plain `Error`; it throws
  a class from its area's errors (each workspace's `src/errors/`, `.cursor/hooks/hooks.errors.mjs`). Tests, fakes and `scripts/` are
  exempt. The classes are listed in [docs/overview.md](docs/overview.md#errors).

### ESLint

`eslint.config.js` is strict and type-aware (typescript-eslint `strictTypeChecked`), with
readability rules: cognitive complexity, max depth/nesting, early returns, no nested ternaries, blank
lines between steps (auto-fixed with `npm run lint:fix`).

- **Tests live in `__tests__/`** next to the code they test (`packages/coding/src/read-file/__tests__/read-file.tool.test.ts`).
  ESLint rejects a `*.test.ts` anywhere else, and Vitest only runs `src/**/__tests__/**/*.test.ts`.
- **No inline escape hatches.** `eslint-disable` comments are rejected
  (`noInlineConfig`). An exception goes in a `files:` override in the config, with a reason.
- **No baseline.** The codebase is lint-clean. If a new rule is ever introduced on existing code,
  `npx eslint . --suppress-all` records the current violations in `eslint-suppressions.json`
  (pay them down when touching a file, then `npm run lint:prune`). Never suppress new code.

### Cursor hooks

`.cursor/hooks.json` runs the same checks automatically while the Cursor agent works.

| Event                           | Script                                 | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beforeSubmitPrompt`            | `.cursor/hooks/require-issue.mjs`      | A chat's first prompt must name its GitHub issue (`#123`, or check out its branch); `NO-ISSUE` opts out, Ask mode is exempt. Remembers the issues named (several for a stack), and "allow cherry-pick", per chat. See "Git workflow".                                                                                                                                                                                                                                                              |
| `beforeShellExecution`          | `.cursor/hooks/guard-git-workflow.mjs` | Denies agent git/gh commands that break the git workflow: a branch not `<issue>-<name>` for one of the chat's issues, `git add -A`/`.`, `--force`, a non-squash merge, an unapproved cherry-pick, a commit message off the format, `gh issue create` without an `area/*` label, interactive `gh stack` forms.                                                                                                                                                                                      |
| `postToolUse` (matcher `Write`) | `.cursor/hooks/lint-edited-file.mjs`   | Formats the file the agent just edited with Prettier, then lints it, and returns notes and problems as `additional_context`, so they're fixed right away. The first edit of harness source in a chat also injects the skill's "Where code goes". The first edit of a file a skill governs (its `harness.json` `governs` globs) names that skill, once per chat. TypeScript written outside every workspace's `src/` is reported on the edit (`layout.utils.mjs`). Advisory: never blocks the edit. |
| `stop` (`loop_limit: 3`)        | `.cursor/hooks/check-on-stop.mjs`      | When a turn finishes (`status: "completed"`), runs typecheck + ESLint for the affected workspaces (turbo, cached), then Prettier check + knip + the layout check + jscpd (new jscpd clones only) on the whole repo. On failure it returns a `followup_message` with the report, so the agent keeps fixing, at most 3 extra rounds.                                                                                                                                                                 |

Shared helpers (stdin/stdout JSON, edited-path lookup, running local binaries) are in
`.cursor/hooks/hooks.utils.mjs`. Cursor reloads `hooks.json` on save; check the **Hooks**
output channel if a hook doesn't fire. To try one by hand:

```bash
echo '{"tool_input":{"file_path":"packages/core/src/tool/tool.utils.ts"}}' | node .cursor/hooks/lint-edited-file.mjs
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
  dependencies. Every issue has at least one **area label**, one per commit scope its PR will have
  (`area/core`, `area/loop`, …, `area/tooling` for work without a scope), plus `security` where it
  applies. The area labels come from the same folders as the commit scopes and are created by the
  `Sync labels` workflow (`scripts/sync-area-labels.mjs`) on every push to `main`. Labels only for
  what types can't say, never for status or priority (`.cursor/skills/git/issues.md`).
- **Status** is read from GitHub: open, blocked, a branch or draft PR (in progress), a ready PR (in
  review), closed by the merge (done). A GitHub Project board, if used, mirrors that.
- **Rewriting:** while the PR is a draft, fixes are folded into the commit they belong to and
  pushed with `--force-with-lease`; once it's ready for review, fixes are new commits on top.
- **Merging:** `gh pr merge <n> --squash` (`gh stack merge <pr> --yes --squash` for a stack).
  Every push of new work is first reviewed by Bugbot and a security review.
- **Enforced:** the issue gate and the git guard (hooks above) for agents; the `Git format`
  workflow (`.github/workflows/git-format.yml`, running `scripts/check-git-format.mjs`) for every
  PR's title, branch, base (`main` or an issue branch, for stacks), `Closes #`/`Part of #` line,
  and an area label on its issue for every commit scope. The `Issue labels` workflow
  (`scripts/check-issue-areas.mjs`) fails, and comments once, on an open issue without an area
  label. Dependabot's PRs are the one kind without an issue.
- **Repo settings** (once, by a person; `.cursor/skills/git/setup.md`): squash merging only,
  defaulting to the PR title; branch protection on `main` requiring the `Git format` and `Check`
  checks.
