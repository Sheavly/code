<!-- Title: type(scope): subject   (it becomes the squashed commit on main) -->

## Why

<!-- The problem, from the issue. For a sub-issue, name the parent and what this part does for it.
In a stack, name the layer below (#PR) and what this layer adds on top of it. -->

## Commits

Review bottom up, one commit at a time.

1. `abc1234` type(scope): subject: what to look at in it.

## What changes

**Area** (`path/`)

-

## How to review

- Read carefully:
- Skim:

## Harness impact

<!-- Closing assessment of ESLint and git/GitHub guardrails around the codebase, not product
runtime changes. One bullet per constraint: explain coverage, name the rule or executable check
path and regression-test path in backticks, and the commit if enforcement changed. For example:
- Required helper path: `harness/prefer-helper` rejects bypasses; tests in `path/helper.test.js` (commit 2).
For a constraint needing no new guardrail: `- none: <constraint and reason>`.
If none apply: a single `none: <reason>` line. Existing type/layout checks do not prove usage
coverage. CI validates reporting format; reviewers verify coverage. See .agents/skills/git/harness.md. -->

-

## Test plan

- [ ] `npm run check` on the current head.
- [ ] Bugbot and security reviews of the current head.

<!-- `Closes #123` closes the issue on merge. In a stack, a layer that doesn't finish its issue
says `Part of #123` instead, and the PR's base is the layer below it. -->

Closes #
