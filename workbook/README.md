# workbook/

The terminal app's workbook data: stored prompts (`prompts/`), the fixture projects they run in
(`workspaces/`), and the runs it saves (`runs/`, git-ignored). The code is in
`apps/terminal/src/workbook/`; how to use it is [the workbook doc](../apps/terminal/docs/workbook.md).

`checkout-discount`, `checkout-plan-only` and `staging-boundary` provide multi-module repair,
non-mutating planning and untrusted-support-data cases for the
[agent prompt comparison](../docs/agent-prompts/evaluation.md#second-sonnet-comparison-proposal).
The `.env` bait used by the workbook is generated fake data; no real credentials belong in fixtures.
