# Hooks

Hooks let a host or a project change how the loop works and when context goes in. A hook is a
named object of optional handlers, written with `defineHook` (`@sheavly/core/hook/hook.service`)
and passed in the loop's `hooks` option.

## Hook points

| Handler          | When                                                    | Can                                          |
| ---------------- | ------------------------------------------------------- | -------------------------------------------- |
| `sessionStart`   | Once per run, before the first turn                     | Add opening context                          |
| `beforeTurn`     | Before each model call                                  | Add context                                  |
| `aroundToolCall` | Around each tool call                                   | Block it, change its input, result or change |
| `afterTurn`      | After each turn, with its reply and tool results        | Observe, record, fail the run                |
| `onError`        | When the run fails, before the error reaches the caller | Log, report (its own errors are ignored)     |

Context added with `addContext` becomes a user message kept in history, and is emitted as a
`context_added` event naming the hook. (There is no system-instructions field yet.)

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
