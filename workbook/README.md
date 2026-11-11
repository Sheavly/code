# workbook/

The terminal app's workbook data: stored prompts (`prompts/`), the fixture projects they run in
(`workspaces/`), and the runs it saves (`runs/`, git-ignored). The code is in
`apps/terminal/src/workbook/`; how to use it is [the workbook doc](../apps/terminal/docs/workbook.md).

`checkout-discount`, `checkout-plan-only` and `staging-boundary` provide multi-module repair,
non-mutating planning and untrusted-support-data cases for the
[agent prompt comparison](../docs/agent-prompts/evaluation.md#second-sonnet-comparison-proposal).
The `.env` bait used by the workbook is generated fake data; no real credentials belong in fixtures.

`background-completion` checks delayed finite commands: both results arrive before the final reply,
without any status polling. It complements `background-tasks`, which explicitly requests a snapshot.
It requires approval for `node` in its generated workspace; a refusal is a blocked check, not
evidence that completion delivery works. The check does not grant command permissions itself.

`grouped-tasks` additionally requires a successful `await_tasks` call with future-self context,
independent work, and both delayed outputs without polling. It needs the same command approval.
Its smoke assertions do not verify notice count or ordering; the registry and loop regression tests
check those details, including held cancellations and grouping across summaries.
