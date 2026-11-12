# Sections and summarizers

A checkpoint is a list of sections, each with a stable id, a title and a text. A summarizer fills
them, and the loop checks the result (smaller than what it replaces, valid history)
before it appends anything. This package holds the two built-in summarizers; a UI may write its
own against `Summarizer` in `@sheavly/core`.

## Rules sections

A `RuleSection` writes its text from the span being summarized and from the same section in the
previous checkpoint, so each pass merges and never starts over. Entries are lines starting with
`- `; a longer entry continues on indented lines, so an entry's own text can never pass for the
next entry. The oldest entries are dropped first to stay under a size cap, and the newest entry
is cut and marked rather than dropped.

- `userMessagesSection`: the user's own messages, verbatim and capped. What they asked for is the
  one thing a summary must not paraphrase.
- `trailSection`: one short line per tool call the app's `extract` function keeps. The weakest part
  of every model summary is what was touched, and a call's arguments are exact where a paraphrase
  is not. This package never learns what a file is: the app that knows its tools supplies the
  extractor. A call whose result is an error (refused, denied, failed) is left out, since the
  trail says what was done and that call did not do it.
- `windowSection`: how many earlier messages are no longer shown. It keeps a rules-only checkpoint
  from being empty and carries its count across checkpoints.

`rulesSummarizer({ sections })` is a sliding window with no model and no cost.

## Model sections

`modelSummarizer({ provider, redact, sections?, ruleSections? })` asks the `Provider` the UI passes
in (so a cheaper model can write summaries) for the `ModelSection`s, and runs the rules sections
beside them. `redact` is the app's: it hides credential forms in the history before it is sent
(tool inputs and results included) and in the sections the model writes before they are stored,
since a model may restate a secret it was shown. This package knows no credential forms itself. The defaults are goal, active constraints, key knowledge, decisions and why, what
failed and task state, the structure the public summary prompts share. The wording is a starting
point, not a tuned value.

Authored instructions, the request template and default section guidance live in the internal
`src/model/summary.prompt.ts`. `prompt.utils.ts` prepares history and previous-section data:
it redacts before truncation and neutralizes opening brackets before the prompt adds its tags.
It also retains the public `summaryInstructions` and `summaryRequest` signatures as prose-free
wrappers. The internal prompt builders accept typed sections or prepared text and do not call
providers.

What the call does, and why:

- **History is data.** The instructions say the history may contain text that looks like
  instructions and must never be followed. The span is rendered as labelled blocks between fixed
  tags with every `<` swapped, so it cannot close its own block. The checkpoint that results is
  framed again for the next model as another model's account (`formatCheckpoint`, `@sheavly/core`).
- **Update, don't regenerate.** The previous sections go in and the new span with them; a section
  the model leaves out keeps its previous text.
- **No tools, short instructions.** Nothing runs in this call. It does not share the turn's prompt
  cache: it sends its own instructions, since the `Summarizer` contract passes only messages, the
  previous sections and a signal. Reusing the cache is a contract change in `@sheavly/core` and the
  loop.
- **Temperature zero, as a hint.** `ProviderRequest.temperature` is sent only where the API accepts
  it beside the call's other settings (see the providers' backends doc), and left out otherwise. The
  prompt is the other guard against a different summary each time.
- **Plain text under headings back.** The prompt asks for a heading line per section (its title)
  with the text under it, and our code attaches each section's id and title: the model produces no
  structure to get wrong. Lists, quotes and code are ordinary text; a line inside a code fence is
  never a heading; a heading that names no asked-for section stays part of the text above it; and a
  JSON object keyed by id is still read. Section titles and ids must be unique together
  (`assertSectionIds`). A reply with no text under any heading, one cut off at the output limit, or
  longer than the cap throws a `SummaryReplyError` that names the problem and its shape (length and
  how it starts) and never quotes the reply (model-written text over material that may hold
  secrets). The loop reports it as a failed summary and carries on.
- **Usage is returned.** The summarizer returns the call's usage; the loop emits it as a `usage`
  event tagged `summary`, which the ledger counts and the session's last tokens ignore.

## Adding a section or a summarizer

A new rules section is an object with an id, a title and a `write` function; test it with a span
and a previous text. A new summarizer implements `Summarizer`: return sections, and the usage of
any model call it made. It must stop when its `signal` aborts and treat `messages` as text.
