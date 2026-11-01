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
npm run check       # the full quality gate: typecheck + lint + format check + tests
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
the tests.

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

| Event                           | Script                               | What it does                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postToolUse` (matcher `Write`) | `.cursor/hooks/lint-edited-file.mjs` | Formats the file the agent just edited with Prettier, then lints it, and returns notes and problems as `additional_context`, so they're fixed right away. Advisory: never blocks the edit.             |
| `stop` (`loop_limit: 3`)        | `.cursor/hooks/check-on-stop.mjs`    | When a turn finishes (`status: "completed"`), runs typecheck + Prettier check + ESLint. On failure it returns a `followup_message` with the report, so the agent keeps fixing, at most 3 extra rounds. |

Shared helpers (stdin/stdout JSON, edited-path lookup, running local binaries) are in
`.cursor/hooks/hooks.utils.mjs`. Cursor reloads `hooks.json` on save; check the **Hooks**
output channel if a hook doesn't fire. To try one by hand:

```bash
echo '{"tool_input":{"file_path":"packages/core/src/tool/tool.service.ts"}}' | node .cursor/hooks/lint-edited-file.mjs
echo '{"status":"completed"}' | node .cursor/hooks/check-on-stop.mjs
```

Both print `{}` when everything passes.
