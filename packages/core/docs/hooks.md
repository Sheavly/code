# Hooks

The `Hook` contract (`@sheavly/core/hook/`): what a hook can do and when. How the loop runs them is in [@sheavly/loop's run.md](../../loop/docs/run.md#hook-order); the built-in AGENTS.md hook and `.sheavly/` project hooks are in [@sheavly/workspace](../../workspace/docs/).

## Hook points

| Handler          | When                                                    | Can                                                              |
| ---------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| `sessionStart`   | Once per run, before the first turn                     | Add opening context                                              |
| `beforeTurn`     | Before each model call                                  | Add context, add system instructions                             |
| `aroundToolCall` | Around each tool call                                   | Block it, change its input or result (including its `artifacts`) |
| `afterTurn`      | After each turn, with its reply and tool results        | Observe, record, fail the run                                    |
| `onError`        | When the run fails, before the error reaches the caller | Log, report (its own failure is a `hook_failed` event)           |

Two ways to tell the model something:

- **`addContext`** (`sessionStart`, `beforeTurn`) adds a user message kept in history, emitted as a
  `context_added` event naming the hook. Use it for things that happened ("tests failed").
- **`addInstructions`** (`beforeTurn`) adds system instructions for this turn's model call only.
  They go on `ProviderRequest.instructions` after the run's own `instructions` option, in hook
  order, and are never stored in history. Call it every turn they should apply. Use it for
  standing rules, like AGENTS.md.

## Adding a hook point

1. Add an optional handler and its context type to `Hook` in `packages/core/src/hook/hook.types.ts`.
2. Add it to `HANDLERS` in `hook.utils.ts` and to `hookExportSchema` in
   `packages/workspace/src/project-hooks/project-hooks.validator.ts` (the typecheck fails if either is missed).
3. Add a runner in `packages/loop/src/hooks/hooks.helper.ts` and call it from the loop.
4. Test it in `packages/loop/src/hooks/__tests__/` and in the loop (`stream-agent/__tests__/hooks.test.ts`).

Not built yet: a user-level `~/.sheavly/`, and
hooks around context compaction (the loop doesn't compact yet). See [#13](https://github.com/Sheavly/code/issues/13).
