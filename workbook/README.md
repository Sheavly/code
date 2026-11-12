# workbook/

The terminal app's workbook data: stored prompts (`prompts/`), the fixture projects they run in
(`workspaces/`), and the runs it saves (`runs/`, git-ignored). The code is in
`apps/terminal/src/workbook/`; how to use it is [the workbook doc](../apps/terminal/docs/workbook.md).

`checkout-discount`, `checkout-plan-only` and `staging-boundary` provide multi-module repair,
non-mutating planning and untrusted-support-data cases for the
[agent prompt comparison](../docs/agent-prompts/evaluation.md#second-sonnet-comparison-proposal).
The `.env` bait used by the workbook is generated fake data; no real credentials belong in fixtures.

`base-prompt-policy` checks that a small edit uses dedicated reading/editing tools, reads back the
result, and does not use commands to commit or publish. Its second step checks non-mutating PR
planning with status, diff, remote tracking, history and authorization in the reply. It is smoke
coverage: edit tools enforce read-before-edit; the scenario does not prove actual git preflight
ordering, staging correctness or live GitHub publication behaviour.

`coding-file-tools` exercises successful `glob` and `grep` discovery plus creation, read-back and
`delete_file` cleanup of a disposable fixture, forbidding shell substitutions. Backend transport
and execution tests separately verify main/child tool schemas, depth-cap task tools and read-ledger
isolation; this workbook check does not claim every child invocation is covered.

`web-search` checks discovery through the app's keyless search backend using a public Node.js
query and verifies a successful tool result with a source URL. It is a live, rate-limited smoke
check, not proof of search relevance or UI artifact rendering; offline tests cover the contract,
artifacts, bounds and failures.

`history-search` reaches a summary on a small window, then needs `search_history` and
`read_history_entry` to find an original line again: the export set to 1234, a value the prompt
never names, so the entry it reads must be one of the file's reads and not the prompt. It does not
prove the summary dropped that line, only that the original text is reachable after a summary. It is a live model check: a summarizer reply
the harness cannot use twice in a row ends the run as `context_window_exceeded`, which fails the
check without being a history-tool bug, so a failure is worth one look at the transcript first.

`summary-stress` forces several summaries in one long run on a small window, plants a code word at
the start, and fails if any summary fails (`couldn't summarize`) or the code word is lost. A model
sometimes decides one pass is enough and skips the re-reads, so no second summary happens; that
fails the first try, not the summarizer, and the retry usually passes. Run it several times to
measure how often summaries fail: `for i in 1 2 3 4 5 6; do npm run workbook -- check summary-stress; done`.

`mask-old-output` reads a large file in eight parts on a small window, so old tool output is hidden
from the model before any summary is needed. A check cannot read the saved model calls, so it only
proves the run still answers from what it kept. To see the masking itself, count the notes:
`grep -c "was hidden to save room" workbook/runs/<run>/model-calls.jsonl` (four in each of four runs
on DeepSeek V4.1). Zero means the window was too large for the reads to reach the threshold.

`summary-quality` measures what summaries keep, not whether they succeed. A decision with its owner
and reason, an error code and the next step are in two small notes read first; four full passes over
a large file force several summaries; the reply must then give all four facts from memory, with no
re-read and no history search. It runs on a 24k window: at 16k the fixed prompt leaves too little
room and a run can stop with `context_window_exceeded`. Six runs on DeepSeek V4.1 passed first try
with four or five summaries each. The reply may say `UNKNOWN` in prose, so the check does not
forbid the word; it requires the four facts instead.

`background-completion` checks delayed finite commands: both results arrive before the final reply,
without any status polling. It complements `background-tasks`, which explicitly requests a snapshot.
It requires approval for `node` in its generated workspace; a refusal is a blocked check, not
evidence that completion delivery works. The check does not grant command permissions itself.

`grouped-tasks` additionally requires a successful `await_tasks` call with future-self context,
independent work, and both delayed outputs without polling. It needs the same command approval.
It also asks the model to report the delivered completion reason, start, duration and user-message
count before emitting `COMPLETION_CONTEXT_CONFIRMED`. Before independent work, it also checks the
live running-task snapshot's IDs, titles, reason, start timestamps and group identity before
remembering `RUNNING_TASKS_CONFIRMED`. These reply assertions are smoke coverage,
not proof of accurate measurements, transient history isolation, notice count or ordering; the registry, formatter and loop
regressions check those details, including held cancellations and grouping across summaries.
