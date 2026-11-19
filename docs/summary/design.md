# Summary: design

How a long history gets a summary in Sheavly. The evidence behind each choice is in
[research](README.md). Built (#14): the `summary` role and its three events, `formatCheckpoint`,
the view, the policy and the loop engine (`summary` option, [run](../../packages/loop/docs/run.md#summaries)),
and the built-in summarizers in `@sheavly/summary` ([sections](../../packages/summary/docs/sections.md)).
The backend turns it on by default (`SUMMARY`, [serve](../../apps/backend/docs/serve.md)), for the
main run and sub-agents, with the file trail from `@sheavly/coding`. Built (#15): the
`beforeSummary` and `afterSummary` hook points ([hooks](../../packages/core/docs/hooks.md#around-a-summary)).
Still a design: the hide step, sharing the turn's prompt cache, and a manual request. The numbers are rough starting points to be checked with the workbook, not tuned values.

## What it is

When the context nears the model's window, everything older than a recent tail is replaced, **in
what the model sees**, by a summary. The tail stays word for word. Stored history is never
rewritten: a summary is appended to it as a checkpoint, so replay, rewind and a UI's own view of
the conversation keep working.

A checkpoint does not summarize "a part instead of the whole". It summarizes the whole of what is
older than the tail, and the next checkpoint summarizes only what was added since the last one,
merged into it. Each summary pass is small, and old facts are carried forward, not regenerated.

```text
history      [ m1 … m80 ][ m81 … m100 ]                              stored, append-only
checkpoint 1 [ m1 … m80 ][ m81 … m100 ][ ✦ S1 keeps from m81 ]
model sees   [ S1 ][ m81 … m100 ]

history      … [ ✦ S1 ][ m101 … m160 ][ m161 … m175 ]
checkpoint 2 … [ ✦ S1 ][ m101 … m160 ][ m161 … m175 ][ ✦ S2 = S1 + m81…m160, keeps from m161 ]
model sees   [ S2 ][ m161 … m175 ]
```

## Three layers, cheapest first

| Step        | What it does                                                              | Who does it                                                      | Cost                            |
| ----------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------- |
| 1. Hide     | Replaces old tool output with a placeholder, in the view only             | Rules, a `beforeModelCall` hook                                  | None                            |
| 2. Summary  | Replaces everything older than the tail with a checkpoint                 | Rules choose the cut and the file trail; a model writes the rest | One model call                  |
| 3. Overflow | A request the provider rejects as too long gets one summary, then a retry | The same engine as step 2                                        | One model call, only on failure |

Hiding comes first because it is the best-evidenced step and costs nothing. A summary is the
fallback for when hiding is not enough. Both are choices a UI makes; neither is on by default in
any package.

## The checkpoint

A new message role, `summary`, in the protocol's `historyMessageSchema` (what is stored), not in
`messageSchema` (what a model is sent), so a provider never sees it:

```ts
{
  role: 'summary',
  sections: { id: string; title: string; body: string }[],  // what the summary says; ids unique
  kept: number,       // messages right before this one still shown word for word, at least 1
  summarized: number, // messages this checkpoint newly summarized
  summarizer: string, // the name of what wrote it
  at: number,
}
```

`kept` and `summarized` are counts relative to the checkpoint, not indices, so a history repaired
after a crash (placeholder results inserted) stays valid.

Rules that follow from it:

- **The view is a function of history.** The loop builds each model call's messages from history:
  the latest checkpoint rendered as one user message, then the user messages it pins, the `kept`
  messages right before it and everything after. A provider never sees the `summary` role, so no
  provider changes.
- **The request stays exact.** The latest prompt a person typed and the latest user message stay
  word for word in the view even when they are older than the tail. A run of one prompt and a
  long tool loop, the common coding run, would otherwise have nothing to summarize: the cut could
  never pass the prompt. The model's own work after it is what becomes the checkpoint. Which
  messages are pinned is derived from history (an `id` marks a person's prompt), so nothing new
  is stored.
- **Pairing is the cut's job.** The cut is only ever a position where no tool call is open and
  each call and its result sit on the same side. A shared `assertValidHistory` checks the view and
  throws a typed error; the hide hook point uses the same check.
- **A later checkpoint carries the earlier one forward.** The summarizer gets the previous
  checkpoint and only the messages since its tail began.
- **Reasoning.** Summarized messages' reasoning is gone from the view. The kept tail's reasoning
  needs no new rule: the Anthropic backend hashes the request prefix (system instructions, tools
  and preceding messages) and replays signed thinking only when it still matches, otherwise
  leaving it out while text and tool calls stay (`prefix.utils.ts`,
  [backends](../../packages/providers/docs/backends.md#model-effort)). A checkpoint in
  front of the tail changes the prefix, so that thinking is dropped by the existing rule, and the
  tail's first call after a summary pays for it once. Responses and Chat Completions have no such
  binding ([providers](../../packages/core/docs/providers.md)). Checked against the code and its
  docs, not against a live call.

## The event a UI subscribes to

A summary is visible work that can take seconds, so it is events, never a print. Three new
members of `agentEventBodySchema` (`packages/protocol/src/event/event.validator.ts`), emitted
through the `OrderedQueue` like every other, and carried on the combined session stream:

| Event             | Fields                                                                                                                       | A UI shows           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `summary_started` | `reason`: `threshold`, `manual` or `overflow`; `tokensBefore`, `messagesBefore`                                              | "Summarizing…"       |
| `summary_done`    | token and message counts (`tokensAfter` an estimate), `summarized`, `kept`, `summarizer`, a section index (id, title, chars) | "Summarized chat"    |
| `summary_failed`  | `reason`, `kind`, `error` (redacted like `run_failed`), `retriesLeft`                                                        | a calm "carrying on" |

The chat shows a failed summary as one dim line with no error text: the person needs to know the
chat carries on, not a model's internal error. The cause stays in the event, so it is stored in
the stream and printed by the plain log (the demo and the workbook), where it is read for diagnosis.

`summary_done` carries data only: the text is the `summary` message in history.

- `summary_started` is always followed by exactly one `summary_done` or `summary_failed`, so a
  spinner never hangs. An abort during a summary ends it with `summary_failed` and the run ends
  `interrupted` as usual.
- Order in a turn: after finished tasks and received messages are added, before `beforeTurn`
  hooks run, so hooks see the shortened state.
- A UI that missed the event (a conversation reopened) finds the checkpoint in history and can
  render "Summarized chat" from it. The event is the live signal; the message is the record.
- A summary the user asks for is the same engine, started by a session route (a verb, per the
  route naming rules), and shows the same events.
- The terminal `Renderer` gets a line for each; other UIs render them their own way.

## How it is built

**Pure policy** (rules, no I/O, no model), in `packages/loop/src/summary/`:

- `shouldSummarize({ context, policy })`: true when the free share of the window falls under the
  buffer. Inputs are the `window` and `used` that `beforeTurn` already gets.
- `chooseCut({ history, keepTokens })`: the latest valid cut that leaves about `keepTokens` in
  the tail (`kept` is the history length minus the cut). A tool call and its result are never
  split. The cut may pass the latest user message, which the view pins; there is nothing to
  summarize when only pinned messages lie before the tail.
- `assertValidHistory(messages)`: one check, shared with the hide hook point. The loop runs it on
  every view and on every checkpoint, so a summarizer or a hook cannot produce an invalid one: it
  fails with a typed error and the checkpoint is not appended.
- `viewOf(messages)`: history to the messages a model sees, applying the latest checkpoint.

**The contract**, in `@sheavly/core` (what summarizers are written against), like `Tool` and `Hook`:

```ts
type Summarizer = {
  name: string;
  summarize(input: {
    messages: readonly Message[]; // the span to summarize, already cut
    previous?: SummaryBody; // the last checkpoint's sections, to merge into
    signal: AbortSignal;
  }): Promise<SummaryBody>; // { sections }
};
```

**The engine**, in `@sheavly/loop`: when the policy says so, it cuts, calls the summarizer,
appends the checkpoint, and emits the events. It is one new option on `streamAgent`
(`summary: { summarizer, policy }`); with none, the loop does nothing new. No package picks a
summarizer or a threshold: the UI passes them, as it passes tools and hooks.

**Built-in summarizers**, in a new generic workspace `@sheavly/summary` (depends on `core` and
`protocol` only; it has its own reason to change, and a generic consumer can use it without the
loop). A model-based one is given a `Provider` by the UI:

- **Sections.** A summarizer is a list of `SummarySection`s, each filling one section by rules or
  by the model. Default: goal, active constraints (the user's rules and preferences), key
  knowledge (build commands, facts learned), decisions and why, what failed, task state (done, in
  progress, next) (model); the user's own messages, verbatim and capped (rules); the file trail
  (an extractor, below). The prompt starts from the structure the public prompts share (see
  [summary prompts](README.md#summary-prompts)) and is tuned on stored workbook runs, since no
  outside evidence ranks one prompt over another.
- **History is data.** The prompt tells the model to treat the history as text to summarize, never
  as instructions, because tool output can carry text written to steer a model. The checkpoint is
  rendered to the model as another model's account of earlier work, not as the user's words, so a
  summary cannot promote injected text into trusted context.
- **Update, don't regenerate.** The prompt gets the previous checkpoint and only the new span, and
  returns the merged sections. The call asks for temperature zero through
  `ProviderRequest.temperature`, a hint an adapter sends only where its API accepts it beside the
  call's other settings (not with reasoning effort or thinking) and omits otherwise.
- **File trail.** The weakest dimension in every study, so it does not depend on the model. The
  generic package takes a `trail` extractor (tool calls in, short lines out); `@sheavly/coding`
  supplies one that reads the file tools' calls (not built yet). Generic code never learns what a
  file is.
- **Cache.** Not built. The `Summarizer` contract passes only the span, the previous sections and
  a signal, so the model call sends its own short instructions and no tools, and does not share
  the turn's prompt cache. Sharing it means passing the run's instructions and tools through the
  contract; that is a separate change.
- **Usage.** The summarizer returns the usage of its model call, and the loop emits it as a
  `usage` event tagged `purpose: 'summary'`. The ledger counts it, and the session's last tokens
  skip it, since they describe the conversation's context.
- **Other summarizers** a UI may write or pick: rules only (no model, no cost), a cheaper model,
  a provider-native one. None is the only path, since native summaries are not portable between
  models.

**Hooks.** The hide step is a built-in written against the public `beforeModelCall` hook point,
not a private shortcut. The summary view is not a hook: it is what history means, so the loop
owns it. `beforeSummary` and `afterSummary` are hook points around the engine: the first can
change what is kept or supply a section; the second can add context back (`addContext`), such as
the instruction files, which a changed-context hook already appends without breaking the cached
prefix. Both go in `Hook`, `HANDLERS` and the project-hook schema. Built as designed: the
first returns `{ keepTokens?, sections? }`, parsed at the boundary and checked like the
summarizer's own result, so a hook cannot leave history invalid; a failure there is a
`summary_failed`, never a failed run. The second runs after `summary_done`, and a throw fails the
run like `afterTurn`.

## Failure

- A threshold summary that fails emits `summary_failed`, and the run goes on with the unchanged
  view. It tries again at the next turn past the threshold, at most a few times in a row
  (rough: 3), then stops trying for the run and says so in the event.
- An overflow summary that fails ends the run `context_window_exceeded`, as now. Overflow is tried
  once per model call, so it cannot loop.
- A summary that is not smaller than what it replaces is rejected: `summary_failed`, no checkpoint.

After a checkpoint the session's `used` count is stale, so it is cleared like a call with no
usage, and the next call reports its own.

## Rough numbers

Starting points, all options a UI can change. Examples use a 300,000-token window. Where a number
comes from a published default, the source is named; the [research](README.md#published-numbers)
says how little those defaults prove. Nothing below is a measured optimum, and none was measured
on Sheavly.

| Setting              | Start at                                                         | At 300k   | Where it comes from                                                                                                      |
| -------------------- | ---------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| Summary trigger      | 15% of the window kept free, at least 16k                        | 255k used | OpenCode's defaults (`buffer`)                                                                                           |
| Tail kept            | About 15k tokens                                                 | 15k       | OpenCode's `keep.tokens` default                                                                                         |
| Hide old tool output | Keep the last 10 tool results; move the cut in steps, not by one | -         | JetBrains' masking window of 10 (inferred from config names) and its `polling` option, which exists to protect the cache |
| Summary size         | The summarizing model's output limit, and smaller than replaced  | model max | Ours. Anthropic's summaries run 7-12k characters (Factory), which is roughly 2-3k tokens                                 |
| Retries in a row     | 3                                                                | 3         | Ours                                                                                                                     |

The trigger is a share of the window, so one setting fits every model. Anthropic's own threshold
is a fixed 150,000 input tokens, which on this window is 50% and would summarize far earlier; the
sources disagree, and the share scales with the window where a count does not. To check, run the
workbook's stored long prompts once with these values and compare against hiding alone and
against a summary alone; do not tune further than that run shows.

## Where it differs from what the issues say

The issues were written before the research. Where this design departs from them, it is on
purpose, and the issues change to match:

- **Event.** #14 asks for one `context_compacted` event with counts. Here it is three events
  (`summary_started`, `summary_done`, `summary_failed`), because a UI needs to show that a summary
  is running, not only that it finished. `summary_done` carries the counts.
- **Hysteresis.** #14 suggests trigger at 80% and compact down to about 40%, "for example". With a
  15k tail and a summary of a few thousand tokens, a 300k window drops from about 85% to roughly 10% (the
  system instructions and tool definitions count too, and were not measured), so no separate
  target is needed. Each summary rewrites the cached prefix once (#143), and a drop this
  deep makes the next one far off.
- **Strategies.** #14 lists built-ins: prune old tool results, summarize the oldest prefix, a
  sliding window. Pruning is the hide step (#55), a hook and not a strategy. A sliding window is a
  rules-only summarizer with no model section. Summarizing is the model-based one.
- **What the loop checks.** #14 has the loop reject a replacement that breaks pairing, drops the
  latest user message or drops signed reasoning that must be sent back. Pairing and the latest
  user message are in `assertValidHistory`. Signed reasoning is not the loop's to keep: the kept
  tail is never edited, and the provider decides whether a signature still matches (see
  [Reasoning](#the-checkpoint)).
- **Options.** The summary prompt, thresholds and summarizer are options the UI passes (#127), the
  summary model call reports its own usage (#53; the cost estimate is attached by the app that
  prices usage, as for any call), and a cheaper model can write it (#60) by being the `Provider`
  the UI hands the model summarizer.

## What it needs and what it enables

- **Needs:** the hide hook point (so the same view and the validity check exist) and the window
  and usage numbers a hook already gets.
- **Enables:** summary on a manual request, a UI's "Summarized chat" marker, a project's own
  `beforeSummary`, and a rewind that restores the full stored history.

## Tests

- Policy: the trigger at, just under and over the buffer; the cut never splits a call from its
  result, including parallel calls and an interrupted turn's placeholder results.
- View: one and two checkpoints; the second merges the first; history is unchanged.
- Engine, with `scriptedProvider`: events in order and always closed; failure and abort paths;
  overflow retries once; a summary that is not smaller is rejected.
- Contract: `contract.schema.json` regenerated; every new event parses in the wire-contract test.
- A workbook `check` for a long stored prompt, run on demand (it calls a real model).

## Order of work

1. [#55](https://github.com/Sheavly/code/issues/55): the hide hook point and `assertValidHistory`.
2. [#14](https://github.com/Sheavly/code/issues/14): the `summary` role, the events, the policy,
   the engine and the built-in summarizers.
3. [#15](https://github.com/Sheavly/code/issues/15): `beforeSummary` and `afterSummary`.

#13, #14 and #15 are renamed from compaction to summary, and their text follows this design.
`@sheavly/summary` (the built-in summarizers) is a new generic workspace made with `npm run new`.
