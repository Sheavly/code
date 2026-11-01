# Hooks

Hooks let a host or a project change how the loop works and when context goes in. A hook is a
named object of optional handlers, written with `defineHook` (`@sheavly/core/hook/hook.service`)
and passed in the loop's `hooks` option.

## Hook points

| Handler          | When                                                    | Can                                                                            |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `sessionStart`   | Once per run, before the first turn                     | Add opening context                                                            |
| `beforeTurn`     | Before each model call                                  | Add context, add system instructions                                           |
| `aroundToolCall` | Around each tool call                                   | Block it, change its input or result (including its `change` / `read` details) |
| `afterTurn`      | After each turn, with its reply and tool results        | Observe, record, fail the run                                                  |
| `onError`        | When the run fails, before the error reaches the caller | Log, report (its own errors are ignored)                                       |

Two ways to tell the model something:

- **`addContext`** (`sessionStart`, `beforeTurn`) adds a user message kept in history, emitted as a
  `context_added` event naming the hook. Use it for things that happened ("tests failed").
- **`addInstructions`** (`beforeTurn`) adds system instructions for this turn's model call only.
  They go on `ProviderRequest.instructions` after the run's own `instructions` option, in hook
  order, and are never stored in history. Call it every turn they should apply. Use it for
  standing rules, like AGENTS.md.

## Built-in: AGENTS.md

`createAgentsMdHook({ root, cwd? })` (`src/runtime/agents-md/`) is a `beforeTurn` hook that
reads AGENTS.md files and adds them as system instructions.

- It looks in every folder from `root` down to `cwd` (default: `root`), like git walks up from
  the working directory, and never above `root`. Files go root first, each under its path, so
  the more specific one comes last and wins.
- It re-reads them every turn, so an edit (even the agent's own) applies on the next model call.
- It caps the total at 32,000 characters, with a truncation note. Empty files are skipped.
- The demo passes it first, before the `.sheavly` hooks.

## Order

- Hooks run in the order given. Every handler runs one after another, except `aroundToolCall`,
  which nests: the first hook is outermost. It calls `next()` to continue, `next(input)` to
  change the input (validated as usual), or returns a result without calling it to block.
- A handler that throws fails the run, except `aroundToolCall` (the call gets an error result)
  and `onError` (ignored).
- A sub-agent run gets only the hooks its parent passes it, and runs its own `sessionStart`.

## Project hooks: `.sheavly/`

```
.sheavly/
  hooks.json        the only required file: { "version": 1, "hooks": [{ "path": "hooks/a.js" }] }
  hooks/            hook files: .js .mjs .cjs .ts .mts .cts, ESM or CommonJS
```

- `loadProjectHooks({ root })` (`src/runtime/project-hooks/`) loads them once at startup, in
  manifest order (`"enabled": false` skips one). Anything broken stops startup with the file
  name and the reason.
- Each file's default export is the hook (`export default` or `module.exports`). It's validated
  like `defineHook`, so plain JavaScript hooks need nothing installed.
- Node runs TypeScript by removing types: no `enum`, `namespace` or parameter properties.
- Plain `.js` / `.ts` follow the project's package.json `"type"`. A hook in the other format
  fails with a message to rename it (`.cjs` / `.cts` or `.mjs` / `.mts`).
- Hosts pass them inside their own: `hooks: [...hostHooks, ...projectHooks]`.

## Adding a hook point

1. Add an optional handler and its context type to `Hook` in `packages/core/src/hook/hook.types.ts`.
2. Add it to `HANDLERS` in `hook.utils.ts` and to `hookExportSchema` in
   `src/runtime/project-hooks/project-hooks.utils.ts` (the typecheck fails if either is missed).
3. Add a runner in `src/loop/hooks/hooks.service.ts` and call it from the loop.
4. Test it in `src/loop/hooks/__tests__/` and in the loop (`stream-agent/__tests__/hooks.test.ts`).

Not built yet: workspace trust before loading `.sheavly/`, a user-level `~/.sheavly/`, and
hooks around context compaction (the loop doesn't compact yet). See [TODO.md](../TODO.md).
