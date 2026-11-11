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

`web-search` checks discovery through the app's keyless search backend using a public Node.js
query and verifies a successful tool result with a source URL. It is a live, rate-limited smoke
check, not proof of search relevance or UI artifact rendering; offline tests cover the contract,
artifacts, bounds and failures.

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
