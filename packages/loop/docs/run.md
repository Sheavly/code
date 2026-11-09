# A run

What `streamAgent` does from start to end, how it runs hooks, and how a session's events are ordered.

## From start to end

`streamAgent(options)` returns an async iterable of events, each with a gap-free `seq`:

1. `sessionStart` hooks run (they may add context).
2. Each turn: finished background tasks are reported, messages sent to the session meanwhile
   (steering) are added, `beforeTurn` hooks run (they may add
   context and this turn's system instructions), `beforeModelCall` hooks run (they may replace
   the messages this one call sends), then the model is called. Text and reasoning stream out as
   they arrive.
3. Tool calls start the moment the model asks for them, each wrapped by `aroundToolCall` hooks.
   Their results are released after the turn ends, in call order (`tool_batch`, `tool_result`).
   A `tool_result` can carry `artifacts`, the tool's data for a UI (a file write's before and
   after, which lines a read covered); the model sees only the text, a UI renders these.
4. `afterTurn` hooks run. Output truncation gets a bounded continuation; otherwise, if the model
   called tools, the next turn starts. Without either, the run ends (or waits for a background
   task). Tasks marked `waitForCompletion`, including sub-agents, always keep the run alive until
   their results are delivered. `waitForTasks` also waits for ordinary background tasks.
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
`max_tokens`, `context_window_exceeded`, `failed`). With `keepSession: true` it goes idle instead, keeping the outcome as `lastOutcome`, so
a conversation's next prompt can resume it; the host ends it when the conversation closes.

## Output-limit recovery

`maxOutputContinuations` permits at most two extra model calls after output truncation by default;
zero disables recovery. The count applies across the whole run, including truncated tool turns,
and never bypasses `maxTurns` or an abort. Partial replies, signed reasoning and completed tool
results stay in history. A new user instruction asks the model to finish without repeating work;
system instructions are not changed and completed tools are not rerun by the loop.
`output_continuation` says which attempt is starting. Exhausting the allowance ends with
`max_tokens`, not `completed`. Context exhaustion ends with `context_window_exceeded` without
retrying: a larger output budget cannot repair a full context window. The loop does not summarize
history or discard messages automatically.

## Context usage

Before every model call the loop reads the provider's `contextWindow` and the session's last
reported tokens (`sessions.lastTokens`) once, and uses that one reading three ways:

- **The agent** gets one short line, e.g. `Context: 48,210 of 400,000 tokens used (12%)`, as the
  request's `notice` (`sample.helper.ts`), which a provider sends as a last user message after the
  history. "Used" is the last call's input plus its output, what the model saw, not a total over
  calls. The line changes every turn, so it never goes through `instructions` and is never put in
  history: not in `done`'s messages, not resent next turn. It is a field of its own, not a message
  in `messages`, so the cached prefix is unchanged. A provider whose replay state is bound to what
  a call sent has to account for it: Anthropic binds a thinking signature to the notice too, so
  that thinking is not replayed on the next turn (see the provider contract). It shrinks to what
  is known: the window alone before any usage is known, the used tokens alone when the window is
  unknown, nothing when neither is.
- **Hooks** get the same numbers as `beforeTurn`'s and `beforeModelCall`'s `context` (`window`,
  `used`), so a hook that hides old output decides from what the agent sees.
- **A UI** gets the window on the call's `usage` event (`usage.contextWindow`) next to its tokens,
  emitted after the turn's stream and before `turn_end`. The harness renders nothing itself: the
  line is for the model, and a UI shows usage however it likes from the event.

The numbers belong to the session, so a sub-agent has its own against its own provider's window,
and a conversation's next prompt carries on from the last call. A call that reported no usage
clears them, since stale ones would say the context is emptier than it is. After a model switch
the count is the previous model's measure of the same history, paired with the new window until
the next call reports its own.

## Hook order

- Hooks run in the order given. Every handler runs one after another, except `aroundToolCall`,
  which nests: the first hook is outermost. It calls `next()` to continue, `next(input)` to
  change the input (validated as usual), or returns a result without calling it to block.
  The result is `{ content, isError, artifacts? }`: `content` goes into history, `artifacts`
  (what the tool returned for a UI, see [artifacts](../../core/docs/tools.md#artifacts)) go only onto the
  `tool_result` event, so a hook can drop, replace or add some without the model seeing them.
- `beforeModelCall` hooks chain: each gets a deep copy of the previous result, and the last result
  is what the model call sends. The run's stored history is not that array and is never changed
  by it; the turn goes on appending the reply and tool results to the history. Each result is
  parsed as a list of messages and goes through `assertValidHistory` (`history/`), so something
  that is not messages, a broken pairing, an empty list, or a dropped or changed latest user
  message fails the run with an `InvalidHistoryError` naming the hook, before any model call. A
  hook that returns its input unchanged is not checked. An abort while a hook runs ends the run
  `interrupted`. A hook whose result added, dropped or edited messages emits
  `model_input_changed` (`{ hook, turn, added, removed, edited }`) through the ordered queue,
  after the turn's `context_added` events and before the model streams. A hook that returns what
  it was given emits nothing.
- A handler that throws fails the run, except `aroundToolCall` (the call gets an error result)
  and `onError`: its failure doesn't stop the other `onError` handlers or replace the run's
  error, but it is reported as a `hook_failed` event (`{ hook, handler, error }`, from a
  `HookError` in `runtime/errors/`).
- A sub-agent run gets only the hooks its parent passes it, and runs its own `sessionStart`.
