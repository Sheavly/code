# Rules

The file kinds and every `harness/*` rule the shared config (`baseConfig`) applies to every workspace.

## File kinds and conventions

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
| `helper`    | stateless functions; may do I/O, call services           | code, no classes             | none      |
| `service`   | code that owns state                                     | code, at least one class     | 300       |
| `tool`      | one agent tool (`defineTool`)                            | code                         | 150       |
| `adapter`   | one model backend (`defineAdapter`)                      | code                         | 150       |
| `routes`    | one group of HTTP routes (a function building a `Hono`)  | code, no classes             | 150       |
| `errors`    | error classes                                            | code                         | 150       |
| `component` | one React view (`.tsx`), a function component            | code, no classes             | 150       |
| `fake`      | test-only fakes in a `testing/` folder                   | code                         | 300       |
| `test`      | Vitest files in `__tests__/` (`.test.tsx` for a view)    | code                         | 500       |

Max lines counts lines of code (blank and comment lines aside), enforced by `max-lines`. `utils` and
`helper` files have no cap: they are stateless functions that grow with their subject, so a long one
is split by responsibility only when it does several jobs, not to fit a number. A file with no kind
(an entry point, the demo) is capped at 300. The limits live in `file-kinds.js`.

- `harness/file-kind`: every module file is named `<name>.<kind>.ts` (kebab-case, known kind);
  tests only in `__tests__/`, and only tests there. Only a `component` (a React view) is
  `<name>.component.tsx`, and a test of one may be `.test.tsx`: a kind's extensions are in
  `file-kinds.js`, and a package never exports a `.tsx` kind (views belong to an app).
- **React** (`react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`, every workspace's
  source): a hook is called only from a component or another hook, with its dependencies listed.
  Plain `.ts` tests and fakes are excluded because their lifecycle helpers also use `use*` names;
  `.tsx` tests remain checked.
- `harness/kind-contents`: code files export no types and no literal constants; those go in the
  module's `*.types.ts` / `*.constants.ts`. A `*.service.ts` exports a class, a `*.helper.ts`
  none, and only a `*.validator.ts` exports zod schemas. Unexported local types, values and
  schemas are fine.
- `harness/pure-imports`: `*.utils.ts` and `*.validator.ts` import no I/O modules and no services, helpers, tools or adapters.
- `harness/layout` and `harness/imports`: every workspace holds together as the layout reads it
  from the workspaces (a domain, named after its folder, no app or coding-from-generic edge, and
  a transport such as `@sheavly/client`, `sheavly.transport`, only from an app), and
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
  exempt. The classes are listed in [the overview](../../../docs/overview.md#errors).
- **Branded ids** (`harness/branded-ids`, in `*.validator.ts` and `*.tool.ts`): a schema property
  named `id` or `<x>Id`, and an id schema `<x>IdSchema`, is a branded zod schema
  (`z.string().brand<'SessionId'>()`), never a bare `z.string()`, so a session's id can't go where a
  tool call's does. The brand is type-only: the wire and the JSON Schemas stay plain strings.
  `harness/no-brand-cast` (type-aware, tests included) fails `as` to a branded type: a value gets
  its brand by parsing with its schema (`sessionIdSchema.parse(id)`).
- **Is inside** (`harness/no-dotdot-prefix`, every file): no `relative.startsWith('..')`, which
  also matches a folder named `..x/`. Use `isInside` (`@sheavly/workspace`'s
  `workspace/workspace.utils`), or compare `relative === '..' || relative.startsWith(`..${path.sep}`)`.
- **Keys** (`harness/no-credentials-file` and `harness/no-key-holder-import`, every file,
  tests included): the credentials file holds every model's key, so only `CredentialStore`
  (`@sheavly/storage`) reads it, and only the backend app uses what hands keys out. No other code
  names `credentials.json` (in any case, with either separator, in a string or a template), and
  none imports `@sheavly/storage/credential-store/*` or `@sheavly/storage/profile-registry/*`: an
  open profile of the registry reads and sets keys, so it is the same door. The store refuses a
  file others can read, never puts a key in an error and queues writes; code that opens the file
  itself does none of that.
  The exceptions are `files:` overrides, each in the workspace's `eslint.config.js` with its
  reason: the credential store's own folder may name the file, and the backend app's one module
  that holds keys may import the store (the override goes in with the module that first needs
  it). `workspace-coverage.test.js` reads every source file's resolved config and fails an
  override that turns a rule off outside those places (the credential store's folder for the
  file name, `apps/backend` for the import), and fails one that covers a whole workspace, so
  widening an exception means editing that test, where review sees it.
- **File writes** (`harness/no-direct-file-writes`, source files; tests and fakes write fixtures
  into temp folders and are exempt): no import of a function that creates, changes, moves or
  deletes a file or folder from `node:fs` or `node:fs/promises` (`writeFile`, `appendFile`,
  `rename`, `rm`, `mkdir`, `cp`, `createWriteStream`, `chmod`, `open`, and the rest, sync forms
  included), and no whole-module import (`import fs`, `import * as fs`, `import('node:fs')`) that
  would hide which are used: read functions are imported by name. The user's data is written
  through `@sheavly/storage` (`writeJsonFile`, `appendJsonLine`, `DocumentFile`, a store): atomic
  and private, retried on Windows, one change at a time, and the path checked. A hand-rolled copy
  of that is how the trust store ended up with a temp name two writes could share. The exceptions
  are `files:` overrides in the workspace's `eslint.config.js`, each with its reason: the storage
  primitives themselves, the agent's two file-writing tools (`Workspace` confines them), the
  backend's model-call debug log, and the terminal's developer tooling (the workbook and the
  demo's SSE log). `workspace-coverage.test.js` lists those files and fails an override for any
  other, or for a whole workspace.

## The rest of the config

`eslint.config.js` is strict and type-aware (typescript-eslint `strictTypeChecked`), with
readability rules: cognitive complexity, max depth/nesting, early returns, no nested ternaries, blank
lines between steps (auto-fixed with `npm run lint:fix`).

- **Tests live in `__tests__/`** next to the code they test (`packages/coding/src/read-file/__tests__/read-file.tool.test.ts`).
  ESLint rejects a `*.test.ts` anywhere else, and Vitest only runs `src/**/__tests__/**/*.test.ts`.
- **No inline escape hatches.** `eslint-disable` comments are rejected
  (`noInlineConfig`). An exception goes in a `files:` override in the config, with a reason.
- **No baseline.** The codebase is lint-clean, and a new rule lands with its violations fixed.
  Never suppress new code.
