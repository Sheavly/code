# Rules

The file kinds and every `harness/*` rule the shared config (`baseConfig`) applies to every workspace.

## File kinds and conventions

Everything below lives in `packages/eslint-config/src/`: kinds and their policies in `file-kinds.js`,
the rules in `rules/` (registered in `plugin.js`, tested in `__tests__/`), and the config every
workspace uses in `base.js`. Each workspace's `eslint.config.js` is
`baseConfig({ tsconfigRootDir: import.meta.dirname })` plus its own boundaries; `npm run lint` at the
root lints every workspace with its own config. Each convention is its own rule ID, so an override
switches off exactly one, on the files it is for, with a reason.

| Kind        | Holds                                                    | May export                                     | Max lines |
| ----------- | -------------------------------------------------------- | ---------------------------------------------- | --------- |
| `types`     | shared shapes                                            | only types (imports `type`s)                   | 300       |
| `constants` | literal values, `as const`                               | only literals                                  | 300       |
| `prompt`    | authored model text, tables and pure typed renderers     | text/data, functions; no types/classes/schemas | 300       |
| `utils`     | pure helpers: no I/O, no services                        | code                                           | none      |
| `validator` | zod schemas for external input, `parse*` functions; pure | code, schemas                                  | 300       |
| `helper`    | stateless functions; may do I/O, call services           | code, no classes                               | none      |
| `service`   | code that owns state                                     | code, at least one class                       | 300       |
| `tool`      | one agent tool (`defineTool`)                            | code                                           | 150       |
| `adapter`   | one model backend (`defineAdapter`)                      | code                                           | 150       |
| `routes`    | one group of HTTP routes (a function building a `Hono`)  | code, no classes                               | 150       |
| `errors`    | error classes                                            | code                                           | 150       |
| `component` | one React view (`.tsx`), a function component            | code, no classes                               | 150       |
| `fake`      | test-only fakes in a `testing/` folder                   | code                                           | 300       |
| `test`      | Vitest files in `__tests__/` (`.test.tsx` for a view)    | code                                           | 500       |

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
  module's `*.types.ts` / `*.constants.ts`. A code file also keeps no top-level literal `const`,
  exported or not (the kind's `constantsElsewhere` policy; fakes and tests are exempt): a number,
  string, regex or literal table moves to `*.constants.ts`. A `*.service.ts` exports a class, a
  `*.helper.ts` none, and only a `*.validator.ts` exports zod schemas. Unexported local types and
  schemas are fine.
- `harness/pure-imports`: `*.utils.ts`, `*.validator.ts` and `*.prompt.ts` import no I/O modules and no services, helpers, tools or adapters. Prompt files additionally reject mechanically recognizable direct I/O, model calls and state/side effects; pure rendering, local helpers and pure dependencies are allowed.
- `harness/layout` and `harness/imports`: every workspace holds together as the layout reads it
  from the workspaces (a domain, one of `generic`, `coding` or `tooling`; `tooling` is a workspace
  source never imports, such as this one, so a dependency on it must be a dev dependency; named
  after its folder, no app or coding-from-generic edge, and
  a transport such as `@sheavly/client`, `sheavly.transport`, only from an app), and
  imports follow the graph: another workspace only if `package.json` depends on it (dev
  dependencies for tests), test-only workspaces only from tests and fakes, no relative import
  across workspace roots. Modules marked by `sheavly.appOnlyModules` accept value imports only
  from apps, tests, fakes and their own module internals; package tools cannot select them either.
  Type-only imports are allowed. The check includes package subpaths (including self-imports),
  relative imports, re-exports and literal dynamic imports; layout validates the metadata against
  actual direct `src/` module folders.
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
- **Named exports only** (`harness/no-default-export`): no default exports, so imports and renames
  stay greppable.
- **No barrels** (`harness/no-barrel`): no re-exports; import from the defining file.
- **Env only in apps** (`harness/no-process-env`, `src/` files of packages; tests and apps are
  exempt): no `process.env` or `process.loadEnvFile`. An app reads env and passes `process.env` in.
- **`type`, not `interface`**, and caught errors are named `caughtError`.
- **Fail loudly** (`harness/no-silent-catch`, every workspace plus `.cursor/hooks/` and `scripts/`):
  a `catch` or `.catch()` must use what it caught: rethrow it, check its `code` or class and
  handle only what it expects, or pass it on as `cause`. Turning every error into a default
  (`[]`, `undefined`, a fresh error without the cause) fails.
- **Shared permissions** (`harness/permission-store-root`, backend source): a repo's worktrees
  share one mode and allow list, so every `read`, `setMode`, `allow` or `revoke` on the permission
  store is keyed by an inline `permissionRoot(...)` call, never by a folder's own path. It matches
  stores by name, so a store under another name, `.call` and destructuring are left to review.
- **Typed errors only** (`harness/no-raw-error`): source never builds a plain `Error`; it throws
  a class from its area's errors (each workspace's `src/errors/`, `.cursor/hooks/hooks.errors.mjs`). Tests, fakes and `scripts/` are
  exempt. The classes are listed in [the overview](../../../docs/overview.md#errors).
- **Branded ids** (`harness/branded-ids`, in all source except tests and fakes): a zod schema
  property named `id` or `<x>Id`, and an id schema `<x>IdSchema`, is a branded zod schema
  (`z.string().brand<'SessionId'>()`), never a bare `z.string()`, so a session's id can't go where a
  tool call's does. The brand is type-only: the wire and the JSON Schemas stay plain strings.
  The same names typed `string` in a type literal, interface or inline parameter type
  (`agentId: string`) fail too, in all source except tests, fakes and `*.prompt.ts`: type them with
  the branded type (`SessionId`) made by parsing with the schema (`sessionIdSchema`, `callIdSchema`,
  `taskIdSchema`, …). Every workspace is checked. Only type members are checked: a plain function
  parameter, a class field, `id: string[]`, a `type X = string` alias and a name such as `ids` are
  not, and a `*.prompt.ts` renderer's id parameters stay plain strings by design. It cannot tell
  which kind of id a name holds: that is review.
- **Brand casts** (`harness/no-brand-cast`, type-aware, tests included): `as` to a branded type
  fails; a value gets its brand by parsing with its schema (`sessionIdSchema.parse(id)`).
- **Background work starts through a kind factory** (`harness/no-direct-task-start`, type-aware,
  source files): any access to `TaskRegistry.start` (a call, an alias, destructuring, `.call`,
  `.apply`, a string key, `prototype.start`) fails, found by the receiver's type and not by the
  name `start`. Only the `work.utils.ts` that sits beside the `tasks.service.ts` holding
  `TaskRegistry` (the runtime's `startWork`) may; tests and `src/testing` files are exempt through
  the shared config's ignores. A registry typed `any`, cast to another shape, assigned to a
  structural type that re-declares `start` or extended through a mixin is left to review, and so
  is whether reads of the shared registry pass the caller's session.
- **A task kind is not compared by hand** (`harness/no-adhoc-task-kind`, type-aware, source files
  of packages, not apps): a comparison (`===`, `!==`, `==`, `!=`, either side) or a `switch` on a
  value whose type is a union of two or more of `'task'`, `'agent'` and `'service'` fails. It reads
  the type's shape, not its name (`TaskKind` is `z.infer` of a schema), so any such union fails,
  one of a UI's own too; a check for presence (`kind === undefined`) passes. Which kinds are finite
  (held open for, grouped, awaited, waking an idle session) is decided once, by `isFiniteKind`
  (`@sheavly/runtime/tasks/work.utils`), so a new kind joins the finite machine there. Only that
  `work.utils.ts`, beside the `tasks.service.ts` holding `TaskRegistry`, may compare; tests and
  `src/testing` files are exempt through the shared config's ignores, and an app may compare kinds
  to show them apart (counting commands, agents and services is presentation, not policy). A kind
  widened to `string` or `any` first, a lookup (`Set.has`, `includes`, a record indexed by the
  kind), a type of one literal only, a union that mixes in another literal, and a comparison in a
  test are left to review.
- **The latest request** (`harness/no-adhoc-latest-request`, source files): no
  `findLast`/`findLastIndex` looking for the last `user` entry by hand. What a request is in stored
  history is decided once, by `latestRequest`, `latestRequestIndex` and `latestPromptIndex`
  (`@sheavly/core/history/history.utils`): a stored `user` entry, never a notice, which only becomes
  a `user`-role message in what a model is sent. Code that works on a model's input says so with a
  `files:` override and its reason. It sees only this call shape, so a lookup written another way
  (a loop, a reversed copy) is left to review.
- **The main session** (`harness/no-adhoc-main-session`, source files): no `session.depth === 1`
  (or `!==`, `==`, either side). The main session is the one without a parent, defined once by
  `isMainSession` (`@sheavly/protocol/session/session.utils`); how the main run ended is asked of
  `runEnd` (`@sheavly/protocol/status/run-end.utils`). It sees only a comparison of a `.depth`
  member with the literal 1, so a depth copied into a variable first is left to review.
- **Instruction context** (`harness/no-direct-instruction-context`, source files): no import of
  `instruction-context.helper` (`appendInstructionContext`). An instruction source is an
  `InstructionSource` built with `createInstructionHook`, which resolves the working root each turn
  and owns the dedup; its own file is the one `files:` exception, in the workspace's
  eslint.config.js. It matches the import, so a copy of the helper's text written by hand is left
  to review.
- **Instruction source reads** (`harness/no-raw-fs-in-instruction-source`, source files): a file
  that imports the instruction factory or its types (`instruction-source.helper`/`.types`) does not
  import `node:fs` or `node:fs/promises`. An instruction source's folder can be the agent's choice
  (a working root), so its reads go through `readConfinedFile`
  (`packages/workspace/src/instruction-context/confined-read.helper.ts`): real path inside the boundary, never `.env*`,
  no link swapped after the check. The skills source is the one `files:` exception, since it reads
  folders fixed at build time. `instruction-source-rules.test.js` pins where the rule and
  `harness/no-direct-instruction-context` are on and off. A source that reads through a helper
  that itself uses `node:fs` is not seen: the rule looks at the source file's own imports.
- **Locked changes** (`harness/no-raw-serial-queue`, source files): no `new SerialQueue()`. A store
  that reads a file and writes it back whole changes it through `LockedChange`
  (`packages/storage/src/serial-queue/locked-change.service.ts`): a queue in the process plus a
  lock file across processes, so two processes on one `~/.sheavly` lose no update. The primitive,
  the append-only `AppendLog` and the profile registry's queue are the three `files:` exceptions in
  `packages/storage/eslint.config.js`; `no-raw-serial-queue.test.js` pins where the rule is on and
  off. It sees the construction only, so a queue passed in from elsewhere, or a lock written by
  hand, is left to review.
- **Reading a model reply** (`harness/no-handrolled-reply-reader`, source files): no import of the
  SSE reader (`http/sse.utils`). A protocol gives `readReply`
  (`packages/providers/src/http/reply-reader.helper.ts`) its `parse`, `step` and `finish`, so
  unknown events, a cut-off stream, an abort and the final `done` behave the same in every
  protocol. The shared reader is the one `files:` exception, in `packages/providers/eslint.config.js`;
  `no-handrolled-reply-reader.test.js` pins where the rule is on and off. It sees the import only,
  so a reader that reads the body another way (`response.body.getReader()`) is left to review.
- **Provider policy** (`harness/no-handrolled-provider-policy`, the providers workspace's source,
  enabled in `packages/providers/eslint.config.js`): no `getReader()`, no `'retry-after'` string
  and no `item.source ===` comparison. A body is read by `readReply`, a wait is decided by
  `retry-policy.helper.ts`, and stored reasoning is checked by `ownReplay`
  (`packages/providers/src/http/replay.utils.ts`). `request.helper.ts` (reads the header) and
  `replay.utils.ts` (compares the source) are the two `files:` exceptions; `no-handrolled-provider-policy.test.js` pins where
  the rule is on and off. It matches these spellings only: a status compared as a number
  (`=== 429`), or a header name held in a variable, is left to review.
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
  primitives themselves, the agent's file helper (`file-effects.helper.ts`: `Workspace` confines
  every path it touches), the backend's model-call debug log, and the terminal's developer tooling
  (the workbook and the demo's SSE log). `workspace-coverage.test.js` lists those files and fails
  an override for any other, or for a whole workspace.

- **Guarded change paths** (`harness/guard-env-write`, every coding source file except tests and
  the resolver helper): `resolveWritable` and `resolveDeletable`
  (`@sheavly/coding/files/files.helper`) are the only way to resolve a path for a write or a
  delete, because they refuse `.env` files and `.git` on the requested path and again on the real
  one a symlink resolves to. The effects that change a file (`writeText`, `createParentFolder`,
  `removeFile`) take the path their own resolver returned: `resolveWritable` for a write,
  `resolveDeletable` for a delete, since `resolveWritable` follows a symlink and would remove its
  target. The rule has accept and reject cases in
  `packages/eslint-config/src/__tests__/guard-env-write.test.js`.

- **No terminal I/O** (`harness/no-terminal-io`, `src/` files of packages; tests and apps are
  exempt, an app being read from where the workspace is): no `node:readline` or `node:tty` import
  (static or dynamic) and no `process.stdin`, `stdout` or `stderr`, as a member
  (`process.stdout`), a named import (`import { stdout } from 'node:process'`) or a destructuring
  (`const { stdout } = process`). It cannot see `globalThis.process.stdout`, `process['stdout']` or
  `const p = process; p.stdout`; review carries those. The harness emits typed events and a UI
  renders them; a package that formats output takes a write function from its app. A child
  process's own `stdout` is data and passes.
- **One clock** (`harness/no-direct-clock`, every file, tests included): no `Date.now()`,
  `new Date()`, `Date.UTC`/`Date.parse`, `toISOString`-style calls or `z.iso.*`. The current time is
  `now()` (`@sheavly/core/clock/clock.helper`), dates are Luxon's, and a time is epoch
  milliseconds (`timestampSchema`) everywhere it is stored or sent. To time a duration use
  `performance.now()`.
- **No handwritten notice** (`harness/no-handwritten-notice`, every file except tests, which
  assert on the envelope text): a string or template
  piece holding `harness-notice`, `<harness` or `</harness` fails, because the envelope is written
  only by `formatHarnessNotice` (`@sheavly/core/notice/notice.utils`), which frames the text as
  harness data and escapes what is inserted. It cannot see a tag split inside a word or built from
  a variable, so the formatter's escaping and its tests carry the rest.
- **File-tool guards** (coding source; each is checked structurally, and what it cannot see is
  left to review and the tests named in its file header):
  - `harness/guard-env-read`: a `resolveRead(requested)` call has `assertNotEnvFile` on the
    requested path before it and on the path it returns after it, as statements of their own in the
    same function, since a symlink can point at a `.env` file.
  - `harness/guard-file-tool-resolve` (coding `*.tool.ts` files): a tool never touches the
    workspace's `resolveRead`, `resolveWrite` or `resolveDelete` (a call, an alias, `.call`, a
    destructured property, an import or a re-export of one); it asks the guard in
    `packages/coding/src/files/files.helper.ts` (`resolveReadable`, `resolveWritable`, `resolveDeletable`) or
    `resolveSearchRoot`. A tool file that calls one of those guards must also call `runFileTool`
    (`packages/coding/src/files/file-tool.helper.ts`), the shared abort and error mapping; it
    cannot see that the call wraps the right body. It cannot see a computed key that is not a literal or a resolver reached
    through a helper that is not the guard; `harness/guard-working-root` and review carry those.
  - `harness/guard-search-root`: a `runRipgrep` call has `resolveSearchRoot` earlier in the same
    function, as a statement of its own, because ripgrep applies its `.env` and `.git` excludes to
    what it walks and never to a root path it is given.
  - `harness/guard-working-root`: a `resolveRead`, `resolveWrite` or `resolveDelete` call takes a
    path that went through `anchorToRoot`, so a relative path starts from the working root; it also
    rejects `cwd: workspace.root` and a literal `root: undefined`. It cannot see
    `this.workspace.root`, a `cwd` copied into a variable first, a spread or `root: void 0`; the
    list of what review and tests carry is in the rule's file header, and the design is in
    `packages/coding/docs/file-tools.md`.

## Prompt extraction

Authored model instructions/templates, tool descriptions and parameter guidance belong in an
adjacent `*.prompt.ts`, not a constants file or an execution/schema file. A prompt file is
TypeScript-only and capped at 300 lines of code. It exports named related strings, fragments,
structured prompt data (for example description/parameter-guidance tables or model sections),
and pure typed rendering functions. Keep local rendering helpers there too. Import types with
`import type`; pure utilities, other prompts and configuration constants are allowed. Numeric
limits may be interpolated into text from constants imports; unrelated numeric/business values,
exported types, classes and schemas do not belong in prompt files. Execution, validation, state,
environment access, I/O and model calls remain outside.

Existing public constants may use a direct `const` alias of a named adjacent prompt import when
TypeScript proves the imported value is a single string literal. `harness/kind-contents` rejects
renderer/function aliases, general strings, non-text data, nonadjacent imports and aliases without
type information; `src/__tests__/prompt-alias.test.js` covers these paths. The authored text stays
in the internal prompt module, and the compatibility export can preserve its literal type.

`harness/prompt-location` checks text at recognized model-facing boundaries, not English keywords
or variables named “prompt”:

- the imported `defineTool` binding's description and reachable input-schema `.describe` guidance,
  including the shared tool-schema `withDescription` producer;
- instruction/base-instruction and message options passed to imported harness/agent/composition
  APIs, including `appendInstructionContext`;
- typed model request options and `Provider.stream`, typed message/history content for authored
  system/user messages, hook `addContext`/`addInstructions` and conversation `send`/`followup`;
- typed `ModelSection` titles and guidance, not arbitrary UI titles or `RuleSection` metadata.

Local/import aliases, workspace package/relative imports, static object properties/destructuring,
concatenation, templates, arrays/join, static map projections and ordinary return builders are
traced. Text from a `*.prompt.ts` import is extracted; caller parameters and unresolved runtime
values remain legal. Role tags, tool names, section ids and other routing metadata are not prose
sinks. Human UI/errors/status, unrelated human schema descriptions, tests/fakes (including
metadata-marked test-only workspaces) and stored Markdown prompts are exempt.

Import tracing reads only supported JavaScript/TypeScript sources inside the discovered lint root,
with metadata and source ancestry checked before reads. Symlinked source files/ancestors and escaped
source paths fail closed; unknown data-file imports stay opaque rather than being read or parsed.
Discovery does not scan unrelated type-file contents. `src/__tests__/prompt-source-confinement.test.js`
checks allowed relative/workspace imports and rejection paths with filesystem read spies. These are
lint-analysis boundaries, not changes to agent command grants or workspace/worktree access.

**Limits:** this is bounded static tracing, not a whole-program or natural-language analyzer. It
follows initializers and ordinary return expressions, not later mutation, arbitrary computed
property names, object-rest/nested parameter bindings, callback scheduling, runtime registries,
reflection, external package bodies or all branch/loop execution. Unsupported parameter bindings
remain opaque rather than crashing lint. Typed boundaries need TypeScript services and recognizable defining
contracts; untyped lookalike `send`/`stream`/hook methods are intentionally not matched. A renderer
whose output never reaches a supported sink cannot be identified just by its name. Fully dynamic
user/caller data cannot be classified as authored instructions. Review must cover those paths;
do not suppress violations with inline disables or a baseline.

## System prompt review

`harness/system-prompt-review` checks an explained review record beside the generic
`BASE_AGENT_INSTRUCTIONS` declaration in `packages/host/src/instructions/instructions.prompt.ts`.
It compares two SHA-256 hashes: the current base prompt source inside its backticks and a
deterministic inventory of production `*.prompt.ts`, `*.tool.ts` and their sibling `*.constants.ts`
files. The base is excluded from that inventory so its review comment cannot create a circular
hash. Workspaces come from npm metadata, not a package-name list; test-only and tooling workspaces,
tests and fakes are excluded. Workspace patterns and metadata ancestry are checked before reads;
unsafe paths and symlinked manifests fail with path-only diagnostics, not JSON contents. Each lint
root is independent. These inventory checks do not change agent command grants or workspace/worktree
access permissions.
The full watched source is a conservative signal: implementation and formatting edits can require
review even when they do not change model-facing behaviour.

The record is one JSON block comment marked `@system-prompt-review`, with `version: 1`, `sourcesHash`,
`promptHash`, `decision` (`prompt-updated` or `prompt-unchanged`) and a nonempty `reason`. The rule
rejects missing, malformed, duplicate and stale records. It reads the prompt from ESLint's current
source, so an unsaved prompt edit also invalidates the record. It has no autofix: matching hashes
without an explicit decision and explanation are not an accepted review record.

When the rule reports drift:

1. Compare the watched changes with the base policy and tool descriptions. Keep tool parameters,
   limits and mechanics in their descriptions; update the system prompt only for cross-tool policy.
2. Update the prompt if needed. Otherwise choose `prompt-unchanged` and explain why the existing
   policy still applies.
3. Run `npm run lint:prompt` to obtain the current hashes, then update the record with those hashes,
   the decision and its explanation. Run the command again to verify it matches.
4. Run the affected regression checks and relevant stored-prompt evaluation. Hashes verify source
   correspondence, not that the explanation is sound or the model follows the policy.

The dedicated anchor check runs without caching in both `npm run check` and
`npm run check:affected`, outside workspace filtering. The stop hook invokes it independently for
changed prompts, tools, constants, package metadata and review tooling; its error cannot be scoped away
just because it names the host prompt rather than the changed tool. Acceptance/rejection tests
live in `src/__tests__/system-prompt-review.test.js`; gate wiring is checked in
`../../../scripts/__tests__/gate.test.mjs` and stop behaviour in
`../../../.cursor/hooks/__tests__/prompt-review.utils.test.mjs`.

**Limits:** this does not fetch or track changes to an upstream Cursor prompt, prove semantic
freshness, or inspect the complete dependency graph. Imported helpers and schemas outside the
watched files, provider transformations and runtime configuration can change behaviour without
invalidating this inventory. Saved prompt/tool sources are read from disk; only the base prompt
uses the current lint buffer. Reviewers still assess these changes and the explanation. The record is a reviewed
source snapshot, not a violation-suppression baseline: every detected drift fails.

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
