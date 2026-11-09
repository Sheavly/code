# Summary: research

How other agents and harnesses shorten a long history, what is known about the quality of the
result, and what that means for Sheavly. The design that follows from it is in [design](design.md).

"Summary" is the harness's word for this feature: older history is replaced by a shorter
account of it. The sources and issues call it compaction or condensation; the term is kept only
when quoting them.

Sources were read on 2026-11-09. Where only documentation was readable, not code, the table says
so. Nothing here was measured on Sheavly itself.

## The answer in short

It is neither pure AI summary nor pure rules. Every source that measured both found that each
does something the other cannot, and the harness has something most of them lack: typed history.

- **Rules do the exact, checkable part**: where to cut, keeping tool calls paired with results,
  hiding stale tool output, listing the files touched, carrying the user's own words. This is
  deterministic, free, cache-friendly and testable.
- **A model does the part that needs judgment**: the goal, decisions and why, what failed, what
  is next. Nothing else can write that.
- **Both sit behind one small contract**, so a UI can swap, wrap or replace either part.

## What others do

| Harness                                                                                                    | Trigger                                                                                                                                          | What it keeps                                                                                                                                           | How it summarizes                                                                                                                                                    | Read                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [OpenCode](https://opencode.ai/docs/compaction/)                                                           | A share of the window kept free (`buffer`, default 15%, at least 16k); also once after a provider rejects a request as too long; manual any time | The most recent ~15,000 tokens (`keep.tokens`) word for word; long tool output in that tail is shortened; instruction files re-read as the new baseline | A model call on the full conversation, so it reuses the prompt cache; the summary model is configurable; later runs update the existing summary; structured sections | Docs only                                    |
| [Cline](https://docs.cline.bot/features/auto-compact)                                                      | Near the window limit                                                                                                                            | Replaces the history with the summary; checkpoints let a user roll back                                                                                 | A summarize tool call on the cached conversation, so it costs about one ordinary call. Other models fall back to rule-based truncation                               | Docs only                                    |
| [Codex CLI](https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/compact.rs)              | Automatic (before a turn, mid-turn, after a turn) or manual                                                                                      | Its source defines a 20,000-token cap for user messages carried over; it re-adds its initial context                                                    | A "handoff summary for another LLM" prompt: progress and decisions, constraints, next steps, critical data. Runs pre- and post-compact hooks that can stop it        | Source, partly (the first 12,000 characters) |
| [Gemini CLI](https://google-gemini.github.io/gemini-cli/docs/cli/commands.html)                            | `/compress`, by the user                                                                                                                         | Replaces the entire chat context with a summary                                                                                                         | Not read                                                                                                                                                             | Docs only                                    |
| [Claude Code](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)              | Near the window limit                                                                                                                            | The summary plus the five most recently accessed files                                                                                                  | The model summarizes architectural decisions, unresolved bugs and implementation details, and drops redundant tool output                                            | A blog post                                  |
| [OpenHands](https://www.openhands.dev/blog/openhands-context-condensensation-for-more-efficient-ai-agents) | A size threshold, so the rebuilt prefix is amortized over many cached turns                                                                      | Recent events intact                                                                                                                                    | Summarizes the user's goals, progress and what remains, plus critical files and failing tests                                                                        | A blog post                                  |
| [Anthropic API](https://platform.claude.com/docs/en/build-with-claude/compaction)                          | On demand, or when input tokens reach a threshold you set                                                                                        | A signed `compaction` block replaces the summarized messages; you choose how many recent turns to send after it                                         | The server writes it; you may supply your own prompt. Compacting again summarizes the old summary and what followed                                                  | Docs                                         |
| [OpenAI API](https://developers.openai.com/api/docs/guides/compaction)                                     | `compact_threshold` on a request, or a standalone `/responses/compact` call                                                                      | An encrypted, opaque item carries prior state; the returned window may also hold retained items                                                         | Server-side; not human-readable; not portable between models                                                                                                         | Docs                                         |

Two further Anthropic mechanisms matter because they are not summaries:
[context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) clears
old tool results by rule (`trigger`, `keep` the last N, `clear_at_least`, `exclude_tools`) and
leaves a placeholder; Anthropic calls it "one of the safest lightest touch forms" of compaction.

## Findings that shape the design

**When.** Everyone triggers on a share of the window or a token budget, not a turn count.
OpenCode's free-room buffer scales with the window, so one setting fits every model; a fixed
count does not. OpenCode and Anthropic both also recover reactively when a request is rejected as
too long. OpenHands triggers late and rarely on purpose: every rewrite breaks the cached prefix,
so rare large rewrites beat frequent small ones.

**What to keep.** Everyone keeps a recent tail word for word and summarizes only what is older.
Anthropic's guidance is blunt about the cut: put it "where no tool call is left open, with each
tool call and its result on the same side", and the API rejects a request whose last assistant
turn has an unanswered tool call. Pairing is therefore a cut-point rule, not a repair step.

**Cache.** A summary that is written by calling the model on the full conversation plus an
instruction at the end reuses the normal prompt cache (OpenCode, Cline). A summary call that
sends a different prefix does not, and the JetBrains study found each such call can cost over 7%
of a run. The rewritten history then misses the cache once, by design.

**Thinking and signed state.** Anthropic says reasoning kept from before a client-side summary
"fails the prefix check", and Sheavly's providers already bind replay state to what a call sent
(see [context usage](../../packages/loop/docs/run.md#context-usage)). The kept tail's reasoning
needs a rule, and it is the provider's to know.

**Provider-native summaries are real but not portable.** OpenAI's is opaque and encrypted;
OpenCode notes it only works with the same provider and model, and falls back to the original
conversation on a switch. A harness that lets the user switch models mid-conversation cannot make
that its only path.

## What is known about quality

| Finding                                                                                                                                                                                                            | Source                                                                                                           | Weight                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Models use long context unevenly; accuracy falls as input grows, even on simple tasks. A smaller context is better in itself, not only cheaper                                                                     | [Chroma, Context Rot](https://www.trychroma.com/research/context-rot) (18 models)                                | A controlled report; not about agents                                                                                                         |
| Hiding old tool output with a placeholder, keeping reasoning and actions, halved cost against doing nothing and matched or slightly beat LLM summarization in four of five settings                                | [JetBrains, The Complexity Trap](https://arxiv.org/abs/2508.21433) (SWE-bench Verified, 500 instances)           | Peer-reviewed workshop paper; Qwen3 and Gemini 2.5 Flash, not frontier models; window size had to be tuned per scaffold                       |
| Summarized runs lasted about 13-15% more turns: summaries seem to smooth over signs that the agent should stop                                                                                                     | Same                                                                                                             | Same; a hypothesis the authors offer, not proven                                                                                              |
| Masking first, a summary only as a last resort, was 7% cheaper than masking alone and 11% cheaper than summary alone                                                                                               | Same (their hybrid)                                                                                              | Same                                                                                                                                          |
| A structured summary with fixed sections, and merging only the newly dropped span into the existing one, kept more than OpenAI's opaque compaction or Anthropic's regenerated summary (3.70 vs 3.35 and 3.44 of 5) | [Factory](https://factory.com/news/evaluating-compression) (36,611 messages, GPT-5.2 as judge)                   | A vendor's study of its own product, with an LLM judge, on its own sessions. Treat the size of the gap as unreliable; the direction as a hint |
| **Every method scored low, 2.19 to 2.45 of 5, on knowing which files were touched**, even with a section for them. The authors suggest a separate artifact index                                                   | Same                                                                                                             | Same, but this is the finding that most changes the design                                                                                    |
| Tune the summary prompt on real traces: maximize recall first, then trim for precision                                                                                                                             | [Anthropic, context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) | Guidance, not a measurement                                                                                                                   |

What this does not tell us: no independent benchmark compares summary quality across harnesses
on frontier models. The numbers above are directions, not a ranking. Sheavly should measure its
own with the workbook's stored prompts (`npm run workbook -- check`) before choosing defaults.

## Published numbers

Numbers other harnesses ship, read on 2026-11-09. They are defaults their authors chose. None is
reported as an optimum, and none was tuned on a model like Sheavly's, so they are a starting
range, not an answer.

| Number                                                      | Value                                                                     | Source                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| When to summarize (OpenCode)                                | 15% of the window kept free, at least 16k                                 | [OpenCode docs](https://opencode.ai/docs/compaction/)                                                            |
| Recent tail kept word for word (OpenCode)                   | About 15,000 tokens                                                       | Same                                                                                                             |
| When to summarize (Anthropic)                               | 150,000 input tokens by default, a fixed count                            | [Anthropic, threshold compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold)    |
| Earlier background summary (OpenCode, experimental)         | Starts 60k tokens before the threshold                                    | OpenCode docs                                                                                                    |
| User messages carried over (Codex)                          | Capped at 20,000 tokens                                                   | [Codex `compact.rs`](https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/compact.rs), constant |
| Tool-result clearing (Anthropic, an example, not a default) | Trigger at 30,000 input tokens, keep the last 3, clear at least 5,000     | [Anthropic, context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)              |
| Observation masking window (JetBrains)                      | 10 observations, inferred from the names of its released configs (`M=10`) | [JetBrains' repository](https://github.com/JetBrains-Research/the-complexity-trap); the definition was not read  |
| Summary length (Anthropic, as measured by Factory)          | Typically 7-12k characters                                                | [Factory](https://factory.com/news/evaluating-compression)                                                       |

What was not found: Gemini CLI's and OpenHands' thresholds (the source paths tried returned 404,
and OpenHands' blog post gives none), any study that varies the trigger or the tail and reports
which value is best, and anything about how large a summary should be. The JetBrains paper says
its window had to be tuned per scaffold, which is a reason to expect the same here.

## Summary prompts

The prompts that are public, read on 2026-11-09. No study compares one summary prompt against
another, so none of these is shown to be best. What they share is the best-supported starting
point.

| Prompt                          | What it asks for                                                                                                                                                                                                                                                                                                                                                    | Source                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex CLI                       | A "handoff summary for another LLM": progress and decisions, constraints and user preferences, what remains, critical data. Five lines. The summary is reinserted behind a prefix saying another model wrote it                                                                                                                                                     | [`prompt.md`](https://raw.githubusercontent.com/openai/codex/main/codex-rs/prompts/templates/compact/prompt.md), [`summary_prefix.md`](https://raw.githubusercontent.com/openai/codex/main/codex-rs/prompts/templates/compact/summary_prefix.md) |
| Gemini CLI                      | A private scratchpad first, then fixed XML sections: overall goal, active constraints, key knowledge, artifact trail (what changed and why), file system state, recent actions, task state (each step marked done, in progress or to do). Says the snapshot is the agent's only memory and to be dense. Tells the model to ignore instructions found in the history | [`getCompressionPrompt`](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/packages/core/src/prompts/snippets.ts)                                                                                                                  |
| OpenHands, as JetBrains used it | Fixed sections: user context, completed, pending, current state; for code also code state, tests, changes, dependencies, version control. Given the previous summary and only the new turns, so it updates one summary. Temperature zero                                                                                                                            | [JetBrains, appendix E](https://arxiv.org/html/2508.21433v3#A5)                                                                                                                                                                                  |
| Anthropic                       | The default prompt is server-side and not public; a caller may replace it. Guidance: maximize recall first, then trim for precision                                                                                                                                                                                                                                 | [Anthropic docs](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand)                                                                                                                                                     |

What they agree on: fixed sections, the user's goal and constraints, what is done and what is
next, the errors and tests that matter, and the files touched. Two things only some do: a
reasoning pass before the summary (Gemini), and treating the history as data to be summarized,
never as instructions (Gemini). The second matters for a harness: tool output can carry text
written to steer a model, and a summary would carry it into trusted context.

Not read: OpenCode's and Cline's prompts (the source paths tried returned 404), and the full
OpenHands prompt as shipped, which JetBrains says it shortened for code tasks only.

## What the research means for Sheavly

1. **Cheap rules come first.** Hiding stale tool output is the best-evidenced first step, and it
   needs no model call. The planned view-only hook point (#55) is that step.
2. **A summary is the second step**, for when hiding is not enough, and it is bounded: it
   replaces only what is older than a kept tail.
3. **The file trail should not depend on the model.** It was the weakest dimension everywhere,
   and the harness can build it from the tool calls in history.
4. **Structure beats free prose**, and updating an existing summary beats rewriting it.
5. **Pairing is the cut's job.** Choose a cut that cannot split a call from its result, and
   validate the result with one shared check.
6. **Do not depend on one provider's feature.** Native summaries are a strategy a UI may choose,
   never the only path.

## Gaps

- Claude Code, Cursor and Warp are closed; only what they publish is cited.
- OpenCode and Cline are cited from documentation. Their code was not read (the paths tried
  returned 404). Gemini CLI's compression prompt was read from source, but not its trigger or
  what it keeps.
- Codex's source was read only in part, so what it keeps is stated from a constant and its
  prompt, not from the code that applies them.
- Nothing here says how large a tail or buffer is right for Sheavly's models.
