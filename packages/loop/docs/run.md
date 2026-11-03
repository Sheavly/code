# A run

What `streamAgent` does from start to end, how it runs hooks, and how a session's events are ordered.

## From start to end

`streamAgent(options)` returns an async iterable of events, each with a gap-free `seq`:

1. `sessionStart` hooks run (they may add context).
2. Each turn: finished background tasks are reported, messages sent to the session meanwhile
   (steering) are added, `beforeTurn` hooks run (they may add
   context and this turn's system instructions), then the model is called. Text and reasoning
   stream out as they arrive.
3. Tool calls start the moment the model asks for them, each wrapped by `aroundToolCall` hooks.
   Their results are released after the turn ends, in call order (`tool_batch`, `tool_result`).
   A `tool_result` can carry `artifacts`, the tool's data for a UI (a file write's before and
   after, which lines a read covered); the model sees only the text, a UI renders these.
4. `afterTurn` hooks run. If the model called tools, the next turn starts; otherwise the run ends
   (or waits for a background task, with `waitForTasks`).
5. `done` is always last and carries the full history, valid to continue from, and the run's
   session (every run is a session with an id; see [sessions](../../runtime/docs/sessions.md)).

Each event also joins its session tree's combined stream the moment it is released
(`sessions.publish`), so a UI following every session at once (`sessions.subscribeEntries`) sees
a sub-agent's activity in the same order as its parent's: a sub-agent's start comes after the
`tool_call_started` that launched it. An event with nothing waiting ahead of it is released as it
happens; one queued behind a pending tool result waits for it, as in the run's own stream.

Aborting the signal stops cleanly at any point: unfinished tools get an "interrupted" result, so
history stays valid. If the run fails, `onError` hooks are told and the error is rethrown; an
`onError` handler that fails is reported as a `hook_failed` event, never in place of that error. A
model call that fails after it started tools (a cut-off stream, an error event) first stops those
tools and emits their results, so every `tool_call_started` is answered, then fails the run.

When the run is over its session ends with the outcome (`completed`, `interrupted`, `max_turns`,
`failed`). With `keepSession: true` it goes idle instead, keeping the outcome as `lastOutcome`, so
a conversation's next prompt can resume it; the host ends it when the conversation closes.

## Hook order

- Hooks run in the order given. Every handler runs one after another, except `aroundToolCall`,
  which nests: the first hook is outermost. It calls `next()` to continue, `next(input)` to
  change the input (validated as usual), or returns a result without calling it to block.
  The result is `{ content, isError, artifacts? }`: `content` goes into history, `artifacts`
  (what the tool returned for a UI, see [artifacts](../../core/docs/tools.md#artifacts)) go only onto the
  `tool_result` event, so a hook can drop, replace or add some without the model seeing them.
- A handler that throws fails the run, except `aroundToolCall` (the call gets an error result)
  and `onError`: its failure doesn't stop the other `onError` handlers or replace the run's
  error, but it is reported as a `hook_failed` event (`{ hook, handler, error }`, from a
  `HookError` in `runtime/errors/`).
- A sub-agent run gets only the hooks its parent passes it, and runs its own `sessionStart`.
