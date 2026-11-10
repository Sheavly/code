# Hooks

The `Hook` contract (`@sheavly/core/hook/`): what a hook can do and when. How the loop runs them is in [@sheavly/loop's run.md](../../loop/docs/run.md#hook-order); the built-in AGENTS.md hook and `.sheavly/` project hooks are in [@sheavly/workspace](../../workspace/docs/).

## Hook points

| Handler           | When                                                    | Can                                                              |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| `sessionStart`    | Once per run, before the first turn                     | Add opening context                                              |
| `beforeTurn`      | Before each model call                                  | Add context, add system instructions                             |
| `beforeModelCall` | After `beforeTurn`, just before the model is called     | Replace the messages sent to this one call                       |
| `aroundToolCall`  | Around each tool call                                   | Block it, change its input or result (including its `artifacts`) |
| `afterTurn`       | After each turn, with its reply and tool results        | Observe, record, fail the run                                    |
| `onError`         | When the run fails, before the error reaches the caller | Log, report (its own failure is a `hook_failed` event)           |

Two ways to tell the model something:

- **`addContext`** (`sessionStart`, `beforeTurn`) adds a user message kept in history, emitted as a
  `context_added` event naming the hook. Use it for things that happened ("tests failed").
- **`addInstructions`** (`beforeTurn`) adds system instructions for this turn's model call only.
  They go on `ProviderRequest.instructions` after the run's own `instructions` option, in hook
  order, and are never stored in history. Call it every turn they should apply. Use it for
  standing rules, like AGENTS.md.

## Context state

`beforeTurn` also receives `context`: `window`, the model's context window in tokens, and `used`,
the tokens the context held as of the last model call (its input plus its output). They are the
numbers the loop tells the agent, so a hook (one that hides old output, or a summary) decides from
the same ones. Either is left out when unknown: `used` before the first call, and `window` for a
provider that doesn't report one. `beforeModelCall` gets the same `context`.

## Changing what the model sees

`beforeModelCall` receives `{ turn, messages, context, signal }` and returns the messages to send
instead, for that one call. Return `messages` to change nothing. Use it to hide old tool output,
drop stale file reads or redact; none of it touches stored history, which the turn keeps
appending to, so replay and a UI's own view of the conversation are unchanged.

- Hooks run in the order given, after `beforeTurn`, and each gets a deep copy of the previous
  hook's result. Editing a message in place, or the array, changes nothing stored.
- Every result is parsed as a list of messages and checked (`assertValidHistory` in
  `@sheavly/loop`): it is not empty, each tool call is paired with its result (no call id twice,
  no result without its call), and the latest user message is still the last user message, word
  for word. A result that breaks this fails the run with an `InvalidHistoryError` naming the hook,
  before the model is called. A hook that returns its input unchanged is never blamed.
- A hook can drop or edit older messages, and it can add messages. A hook whose result changed
  the messages is reported with a `model_input_changed` event
  (`{ hook, turn, added, removed, edited }`, counts only), so a UI or log can show that something
  changed what the model saw. Messages have no ids, so they are matched by what they are: a tool
  result by its call id, an assistant message with calls by its call ids, any other message by
  its text. A rewritten tool result is therefore `edited`, while a reworded user message counts
  as one removed plus one added. Reordering is not reported. The event detects; it doesn't
  prevent: the hook is trusted code, like a project hook behind workspace trust. Use
  `addContext` (`context_added`, kept in history) for what should be recorded, and this for
  what only this call should see.
- If the run is aborted while a hook runs, the run ends `interrupted`, as with any abort.
- Make edits deterministic. A provider reuses the prompt prefix that is byte-identical to the
  previous call (prompt caching), so a hook that trims differently every turn misses the cache
  every turn. Change an old message once, the same way every time, or not at all: hide what is
  older than a fixed point and move that point in steps, not by one message per turn.
- The model's reasoning for a message you keep is sent as it was; whether a provider still accepts
  a signed reasoning block after the messages before it changed is that provider's rule (see
  [providers](providers.md)).

## Adding a hook point

1. Add an optional handler and its context type to `Hook` in `packages/core/src/hook/hook.types.ts`.
2. Add it to `HANDLERS` in `hook.utils.ts` and to `hookExportSchema` in
   `packages/workspace/src/project-hooks/project-hooks.validator.ts` (the typecheck fails if either is missed).
3. Add a runner in `packages/loop/src/hooks/hooks.helper.ts` and call it from the loop.
4. Test it in `packages/loop/src/hooks/__tests__/` and in the loop (`stream-agent/__tests__/hooks.test.ts`).

Every handler is given the model's view of the history (the newest checkpoint as text, then the
messages it kept), never the stored `summary` entries; see
[summaries](../../loop/docs/run.md#summaries).

Not built: a user-level `~/.sheavly/`, and hooks around a summary (`beforeSummary`,
`afterSummary`). See [#13](https://github.com/Sheavly/code/issues/13).
