# Tests

- Tests go in `<module>/__tests__/<name>.<kind>.test.ts`. Anywhere else, ESLint fails it and Vitest never runs it. Root tooling tests are in `scripts/__tests__/` and `.cursor/hooks/__tests__/` (plain `.mjs`).
- Use `scriptedProvider` / `fakeFetch` (`@sheavly/testing`) and temporary directories. Tests never touch the network.
- Cover the guard paths too (rejections, aborts, ordering), not just the happy path.
- State the rule in the test's title. A reader should learn the behaviour from the list of titles.

## Fakes

Fakes live in `@sheavly/testing`, by what they fake: `provider/` (`scriptedProvider`, `callOnceProvider`, `routedProvider`), `fetch/` (`fakeFetch`, `collect`, `requestSentBy`), `tool/` (`toolRunner`) and `wait/` (`until`). It is test-only (`sheavly.testOnly`): a dev dependency, imported only from tests and fakes (`harness/imports`), and lint treats all its source as test code.

A package's own fakes stay in its `src/testing/`: `@sheavly/runtime/testing/` (sessions, approvals, `startTaskTool`), `@sheavly/workspace/testing/` (`useTempWorkspace`, `useFileLocks`), `packages/providers/src/testing/`; core keeps its echo tool in `packages/core/src/testing/`, since core can't depend on the testing package built on it. `packages/eslint-config/src/testing/` holds the throwaway workspaces and skill repos the lint tests build. No mock data in dev or prod code. A generic test that needs a background task uses `startTaskTool`.

## Behaviour, not just units

A lifecycle that several kinds share (background work, status, notices) is tested by one suite that runs every kind through the same assertions, through its real integration path; adding a kind is one table entry. A fake that skips the integration path proves nothing about it.

## Real-model checks

When a change alters what a run does, run `npm run workbook -- check` once it's done (the `git` skill's review step asks for it, and the stop hook nudges once). It runs only the checks whose `areas` the change touched. A new behaviour gets a `check` on a stored prompt (`workbook/README.md`). It's manual and on demand: never put it in CI or `npm run check`, and don't run the demo (`npm run demo`) or the workbook otherwise, since both call a paid model API.

## Time

Fix the clock with `useFixedClock` (`@sheavly/testing/clock/fixed-clock.fake`). Dependency-free project hooks use their central `hookNow()` in `.cursor/hooks/hooks.utils.mjs`; state-lifetime tests pass time explicitly.
