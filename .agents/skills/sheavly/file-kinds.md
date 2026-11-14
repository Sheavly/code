# File structure and kinds

Each workspace holds one folder per module; everything about a module lives in it. Every file is `<name>.<kind>.ts` in kebab-case (`harness/file-kind`):

```
packages/coding/src/run-command/
  run-command.tool.ts        the tool (code only)
  run-command.types.ts       exported types only
  run-command.constants.ts   exported literal constants only
  run-command.prompt.ts      authored model guidance and pure prompt rendering
  run-command.utils.ts       pure helpers (no I/O, no services)
  command-approval.helper.ts stateless functions that call the approval registry
  __tests__/run-command.tool.test.ts
```

Kinds: `types`, `constants`, `prompt`, `utils`, `validator`, `helper`, `service`, `tool`, `adapter`, `routes` (one group of HTTP routes), `errors`, `component` (one React view, `<name>.component.tsx`, in an app; its props type goes in `*.types.ts`), `fake` (a `testing/` folder), `test`. Policies (exports, classes, schemas, max lines) are in `packages/eslint-config/src/file-kinds.js`; a genuinely new kind is added there. Which of the code kinds a file is, lint decides:

- `utils`: pure, no I/O, no services. `validator`: pure too, and only validation: zod schemas for external input (files, env, API events, hook exports) and the `parse*` functions that turn `unknown` into typed data. Validate with `parseOrThrow` / `validate` from `@sheavly/core/validation/validation.validator`, passing your area's typed error.
- `helper`: stateless functions that may do I/O or call services; it exports no class. `service`: owns state, so it exports a class. State with order or a lifecycle (queues, live processes) lives in a service the host creates and injects, never at module level, so tests don't share it.
- `prompt`: authored model instructions, tool/parameter guidance and prompt templates, beside the owning module. Export strings, related prompt data or pure typed renderers; no I/O, environment reads, state, model calls, exported types/classes/schemas or unrelated numeric configuration. Keep execution and validation in their existing kinds. User/runtime data, human-facing messages and test fixtures are not authored prompts. `harness/prompt-location` checks supported model-facing boundaries; moving prose into a constants file does not satisfy it. Prompt files remain internal unless the whole kind is deliberately exported. Review prompt or source changes with `npm run lint:prompt`.

## Rules every file follows

- A code file never exports a type, and never holds a literal constant, exported or not (a number, string, regex or literal table): move it to the module's `*.types.ts` / `*.constants.ts`. A `*.service.ts` without a class, a `*.helper.ts` with one, and an exported zod schema outside a `*.validator.ts` fail too (`harness/kind-contents`). Unexported local types and schemas may stay; fakes and tests keep their own fixture values.
- `*.types.ts` imports only with `import type`; derive schema types there with `z.infer<typeof xSchema>`.
- Module-level functions with more than one input (outside tests) take one destructured `params` object: `function f(params: { a: A; b: B }) { const { a, b } = params; }`.
- `type`, never `interface`. Named exports only. No re-exports (barrels): import from the defining file. Name caught errors `caughtError`.
- No deprecated APIs (`@typescript-eslint/no-deprecated`, in `.ts` and `.js`/`.mjs` alike): use the replacement the error names, never a workaround that hides the `@deprecated` tag.
- Import from the defining file (`../files/files.utils.js`) or a package subpath (`@sheavly/runtime/tasks/tasks.service`).
- A wire type is a zod schema in a `<module>.validator.ts`, its type `z.infer` of it in `<module>.types.ts`; never write one by hand. `harness/single-definition` makes every `*.types.ts` in the workspaces own the types it exports, so a copy anywhere else fails with where the original lives.

## File length

Lint caps lines of code (blank and comment lines aside) per file kind, in `packages/eslint-config/src/file-kinds.js`: `tool`, `adapter`, `routes`, `errors` and `component` 150; `types`, `constants`, `prompt`, `validator`, `service` and `fake` 300; `test` 500; a file with no kind 300. `utils` and `helper` files have no cap: split one by responsibility when it does several jobs, not to fit a number.

When a file hits its kind's limit, split it by responsibility into another `<name>.<kind>.ts` in the same folder (as `stream-agent/` does with `turn.helper.ts` and `sample.helper.ts`).

## Public API

Packages are imported by subpath (`import { defineTool } from '@sheavly/core/tool/tool.utils'`), and only the file kinds a package's `exports` makes public (`"./*.types"`, `"./*.helper"`): its public API, so a new module of an exported kind needs no entry. Any other kind is internal, and `harness/imports` fails the import; make a kind public with `npm run export -- packages/<pkg> <kind>`, in review, never one file at a time (`harness/layout` fails a per-file entry). Close a module that holds a public kind but isn't API (`"./hooks/*": null`), and keep the README's API table to exactly the open modules.
