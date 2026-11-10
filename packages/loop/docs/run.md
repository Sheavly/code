# A run

What `streamAgent` does from start to end, how it runs hooks, and how a session's events are ordered.

## Failure diagnostics

After cleanup and error hooks, `run_failed` carries the error message, session and selected details:
name, system code or provider reason, stack and up to four causes. The stack is limited to 16,384
characters and each cause message to 8,192. Common credential forms are redacted. No exception,
request or response object is serialized. The event reaches subscribers before the failed session
update; the original exception still ends iteration. Diagnostics never enter model history.

## From start to end

`streamAgent(options)` returns an async iterable of events, each with a gap-free `seq`:

1. `sessionStart` hooks run (they may add context).
2. Each turn: finished background tasks are reported, messages sent to the session meanwhile
   (steering) are added, a summary is written if the `summary` option is set and the context
   nears the window ([Summaries](#summaries)), `beforeTurn` hooks run (they may add
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

The automatic wait begins only after a turn without tool calls. Repeated status-tool calls keep
starting model turns instead of waiting; the agent must finish independent work and yield.
Required task completion wakes that wait and reaches history before the next model call, without
another user prompt. Non-required tasks that outlive a run are reported at the next run.

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

Output truncation automatically continues the original task, with no continuation cap by default.
`maxOutputContinuations` optionally bounds recoveries across the whole run, including truncated
tool turns; zero disables recovery. Recovery never bypasses `maxTurns` or an abort. Partial replies,
reasoning and completed tool results stay in history, and completed tools are not rerun by the loop.
The next request carries a transient `output-continuation` notice asking the model to finish
silently without repeating work. Neither synthetic user messages nor changed system instructions
are needed. Provider-bound reasoning is replayed only when its original prefix still matches.
The same notice is emitted as `harness_notice` before the model call, with its attempt and an
optional explicit maximum. Each UI chooses its own presentation; the terminal shows no interruption.
Exhausting an explicit allowance ends with `max_tokens`, not `completed`.
Context exhaustion ends with `context_window_exceeded` without
retrying: a larger output budget cannot repair a full context window. Without the `summary`
option the loop does not summarize history or discard messages; with it, see below.

## Summaries

`summary: { summarizer, policy? }` on `streamAgent` makes the loop write a checkpoint when the
context nears the window. Without it the loop writes none, though a checkpoint already in
`messages` is still applied to what the model sees. No package picks a summarizer or a threshold:
the UI passes them.

- **History and view.** The loop keeps `HistoryMessage[]` (`messages` and `done.messages`): the
  conversation plus any `summary` checkpoints, append-only. A model is sent `viewOf(history)`: the
  newest checkpoint rendered as one user message (`formatCheckpoint`, `@sheavly/core`), then the
  user messages it pins (below), the `kept` messages right before it and everything after. A
  provider never sees the `summary` role, and hooks are handed the same view, so they see the
  shortened state.
- **Pinned prompts.** The latest prompt a person typed (the host gives those an `id`) and the
  latest user message of any kind stay word for word in the view even when they are older than
  the kept tail (`pinnedBefore`). This is what lets a run of one prompt and a long tool loop be
  summarized: everything the model did after the prompt becomes the checkpoint while the request
  stays exact. It is a function of stored history, so no field is stored for it. A pinned
  message is not capped or counted against `keepTokens`, as it was not when it sat in the tail:
  a very large pasted prompt stays in every view, and if the view alone fills the window no cut
  can shrink it.
- **When.** After finished tasks and received messages are added, before `beforeTurn`: threshold,
  when less than the free buffer is left (a share of the window, at least a minimum, never more
  than half of it; unknown window or usage means no summary). Also once per model call when the
  provider rejects the call as too long (`context_window_exceeded`): one summary, then a retry,
  and the run ends `context_window_exceeded` as before if that fails or happens again.
- **The cut.** `chooseCut` keeps about `keepTokens` of the newest messages, never splits a tool
  call from its result. It may cut past the latest user message, which the view pins, and finds
  nothing to summarize only when nothing but pinned messages lies before the tail. The
  summarizer is given the newest checkpoint's sections and the messages since its tail began,
  the pinned prompt included, since it needs the request to write the goal, so each pass is small
  and old facts are carried forward. A pinned message is not counted as summarized or replaced
  (`summarized`, and the "smaller than what it replaces" check), because the view still shows it.
- **Events.** `summary_started`, then exactly one `summary_done` or `summary_failed`, through the
  ordered queue. A failure (the summarizer threw, the run aborted, the result was rejected) is
  redacted like `run_failed`, appends nothing and never fails the run; threshold summaries stop
  being tried for the run after `maxFailures` in a row.
- **Hooks.** `beforeSummary` runs after `summary_started`, in hook order, and may move the cut
  (`keepTokens`) or add sections (`runBeforeSummary`); its result is parsed, and a bad one is a
  `SummaryHookError`, and a throw a `HookError`, in the text of a `summary_failed`, like any other
  failed summary. A hook that
  ignores its signal is raced against the abort, like the summarizer.
  `afterSummary` runs once the checkpoint is appended and `summary_done` is emitted
  (`runAfterSummary`, handing each hook copies of the checkpoint and the view), so what it adds
  with `addContext` follows the checkpoint in history, is
  reported as `context_added`, and a throw fails the run. It is raced against the abort too, and an
  `addContext` that arrives after the abort adds nothing. See
  [hooks](../../core/docs/hooks.md#around-a-summary).
- **Rejected results.** `SummaryRejectedError` (never thrown to the caller; it is the text of a
  `summary_failed`) when the result has no sections, is over `maxSummaryTokens`, is not smaller
  than the messages it replaces, or would leave history that breaks the rules
  (`assertValidHistory`).
- **After a checkpoint** the session's last reported tokens are cleared
  (`SessionRegistry.forgetLastTokens`), since they described the replaced history; the next call
  reports its own.

The defaults (`DEFAULT_SUMMARY_POLICY`) are starting points, not measured values. The design and
its evidence are in [docs/summary/design.md](../../../docs/summary/design.md).

## Context usage

Before every model call the loop reads the provider's `contextWindow` and the session's last
reported tokens (`sessions.lastTokens`) once, and uses that one reading three ways:

- **The agent** gets a typed `context-usage` notice in the request's `notices` (`sample.helper.ts`).
  Providers use the [shared formatter](../../core/docs/providers.md#harness-notices) to label it
  as harness telemetry, not user input, and direct the model to use it silently unless context
  limits affect the task. For example, its measurement is `Context: 48,210 of 400,000 tokens used (12%)`.
  "Used" is the last call's input plus its output, what the model saw, not a total over calls.
  The notice changes every turn, so it never goes through `instructions` and is never put in
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

Before calling the provider, the loop also emits `harness_notice` with the exact notice payload
sent on that request. It uses the ordinary ordered event queue and combined session stream, so
downstream UIs receive structured data with session attribution and replay support, not formatter
text. When neither context count is known, no context notice is sent; recovery notices are independent. Model history and
system instructions still contain neither the notice nor its UI event.

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
