# The quality gate and the dev hooks

```bash
npm run check            # the whole gate through turbo (turbo.json): each workspace's typecheck, build, lint, test, then the root's, plus prettier, knip, jscpd and the layout check
npm run check:affected   # only the workspaces changed since main and their dependents; repo-wide checks in full
npm run check -- --force # bypass the turbo cache
npx turbo run test --filter=@sheavly/core   # one workspace's task (or `npm run test -w @sheavly/core`)
npm run lint:fix   # ESLint auto-fixes, then Prettier (in that order)
npm run format     # Prettier only
npm run lint:prompt # verify the explained prompt/source review record, without caching
```

Every workspace has its own `typecheck`, `lint` and `test` scripts that check only its files; a new package needs all three. Results are cached in `.turbo/cache` by their inputs, so a change reruns only its workspace and the ones that import it.

Finish a change only when `npm run check` passes.

- knip (unused files, exports, types, dependencies; `knip.json`) and jscpd (copied code; `.jscpd.json`) fail on any finding: there is no baseline. Remove dead code; reuse or extract duplicated code. Never add `jscpd:ignore` comments. After deleting dead code, re-run `npm run knip`: removing one export often leaves what it used unused. `npx knip --fix --fix-type exports,types` is allowed; never the `dependencies`/`files` fix types.
- No `eslint-disable` comments (`noInlineConfig`). A justified exception is a `files:` override in the workspace's `eslint.config.js`, with a reason.
- Formatting is single quotes, semicolons, trailing commas and 100 columns (`.prettierrc.json`). Don't hand-format: let Prettier do it.
- Root tooling scripts live in `scripts/` (plain Node ESM, tests in `scripts/__tests__/`).

## How much of the machine the gate uses

Two caps keep `npm run check` from taking every core: `concurrency` in `turbo.json` (5 tasks at once; turbo's default is 10) and `maxWorkers` in `vitest.config.ts` (4 workers per test run; vitest's default is about one per core). Each test run starts its own pool of workers, so the two multiply: uncapped, the gate holds almost every core of a 20-core machine for minutes. Measured on that machine in three capped and three uncapped runs taken alternately, with the machine nearly idle (other processes used about 6% of it in every run, the same in both variants) and the gate's own CPU read from its cgroup, the capped gate used about 17% less CPU for the same work and spent under 2 seconds above 90% CPU where the uncapped gate spent about 90; the wall time was the same within noise (about 215 s). The caps free the machine for other work and do not make the gate faster. Under load from other work, the real-repository lint tests have timed out, but they did not on a quiet machine, so a gain in reliability is not shown. The CI runners, which have 4 vCPUs, were not measured this way.

The worker cap is in the config, not in `VITEST_MAX_WORKERS`, because turbo's strict environment mode strips that variable before it reaches vitest. To override for one run:

- turbo: `npm run check -- --concurrency=<n>` (a count, or a percentage such as `50%`).
- one workspace's tests: `npm test -w <workspace> -- --maxWorkers=<n>`. It runs vitest directly with the root config, and the command-line value wins over the config.

`scripts/__tests__/gate-parallelism.test.mjs` fails if either cap is removed or is not a positive integer or a percentage. It pins that the caps exist, not their values, and no test can measure CPU use.

## The Cursor hooks (`.cursor/hooks.json`)

They run automatically:

- **After each Write**, the edited file is formatted with Prettier, then linted. If the hook says "Prettier reformatted the file", re-read the file before editing it again, since old `old_string` text may no longer match. The first edit of harness source in a chat injects "Backend only" and "Where code goes" from [layers.md](layers.md), and the first edit inside a workspace shows that workspace's README (once per workspace per chat). The first edit of a file a skill governs names that skill, then each of its guides that covers the file, once each per chat: each skill in `.agents/skills/` has a `harness.json` beside its `SKILL.md` with `governs` globs (or an empty list and a `manual` reason), optionally `lintRules`, `ruleFiles` and `guides`. A new skill needs one, and a test fails on a glob that matches no file. TypeScript written outside every workspace's `src/` (other than `NOT_SOURCE` in `layout.js`) is reported on the edit.
- **Before each shell command**, the shell guard (`guard-shell-commands.mjs`, its checks in `shell-guard.utils.mjs`) denies in-place shell editors (`sed -i`, `perl -pi`, `awk -i inplace`, scripted `vim`/`ex`/`ed`) on project files: those edits skip the hooks above and show no diff. Edit with the edit tools; read-only uses and files outside the project stay allowed. It snapshots the project before each command it allows; **after it**, `record-shell-writes.mjs` compares, records any changed files for the stop hook's gate, and reports a command that changed files and isn't a known writer (`SANCTIONED_WRITERS` in `shell-writes.utils.mjs`, grown only by the user) as a workaround. Add it to `DENIED_CASES` (`shell-guard-cases.utils.mjs`) and teach the guard the technique.
- **On stop**, typecheck and ESLint run through turbo (so cached results are reused), then Prettier check, knip, the layout check and jscpd, but only for a chat that edited or deleted project source in this checkout. Each chat records the files it edits (`.cursor/hooks/chat-files.utils.mjs`), and the gate holds it to those. A failure comes back as a follow-up message (up to 3 rounds): fix the cause in code, never by suppressing it. Once they pass, the docs nudge runs.
- **Subagents** (the Task tool) get no `beforeSubmitPrompt` of their own, so `record-subagent.mjs` (`subagentStart`) links each Task call to the chat that made it; a subagent's edits are its parent's to check, and the parent's stop hook waits while one still works.

## Where the hooks keep state

- **Per-chat state** is one JSON file per chat in `~/.cache/sheavly-harness/chats/<id>.json`
  (`SHEAVLY_HOOK_STATE_DIR` moves it, for tests), outside the repo. `.cursor/hooks/chat-state.utils.mjs`
  is its only reader and writer: its schema names every field (the chat's issues and approvals, the
  subagent links, the edited files, the shell snapshots, what the chat was shown once), and a write of
  a field it lacks, or of the wrong type, throws. A new field is a line in that schema. It is plain
  functions, not zod: the guards run before `npm ci`.
- `harness/no-adhoc-chat-state` fails a hook (other than that module and the tests) that names
  `SHEAVLY_HOOK_STATE_DIR` or the `sheavly-harness` state folder, in a string, a template or a longer
  path, so no hook finds the files itself. It cannot see a name split across pieces, and it does not
  check that a read-modify-write of one field goes through `changeChatState` or that a hook asks
  `isTestOrFake` instead of writing its own test-path regex: those two are review.
- A file records its format (`CHAT_STATE_VERSION`). One from before versions is read as version 1 if
  it passes the schema, and any other version is rejected with the field or version named.
- Hooks write the same chat at once, so a write takes a lock (a file beside the state file, holding
  its owner's token), re-reads, merges its fields and replaces the file atomically with private
  permissions: two hooks setting different fields keep both. A hook that changes a field from its
  current value (a list, a map of entries, the edited-file records) uses `changeChatState`, whose
  callback runs with the lock held, as `keepShownInChat`, the shell snapshots and the edit records
  do. A lock a crashed hook left is broken after ten seconds, and a hook releases only a lock that
  still holds its own token; a hook that holds one past those ten seconds can lose exclusivity for
  that write. A chat untouched for `MAX_AGE_MS` is deleted when a new chat starts, with what a
  crashed hook left; only files this module writes are deleted.
- **Shell snapshots** are kept in that state by command text, from the before-hook to the
  after-hook. One older than `SNAPSHOT_TTL_MS` (a command that crashed, or ran for hours) is read as
  absent and dropped (`shell-snapshots.utils.mjs`). An after-hook that finds no usable snapshot, an
  expired one or none (two identical commands at once), can't tell what the command changed, so it
  records the chat's edits as incomplete, in the write that drops the snapshot, and the stop gate
  runs unscoped instead of skipping them.
- **The docs nudge** keeps its own file, cursor-docs-nudged.json, in the clone's git folder
  (`onlyNew` in `docs.utils.mjs`): per clone and shared by its chats on purpose, so a set of changed
  files is nudged once however many chats see it. It is the one state not in the chat files.
- **One matcher each.** `isTestOrFake` (`packages/eslint-config/src/test-paths.utils.js`) answers "is
  this a test or a fake" for the lint rules and the hooks, and `workspaceOfRelative` (`layout.utils.js`)
  "which workspace holds this repo-relative file". Fakes are told by folder, so judge a path below
  its workspace's `src/` where the workspace itself may be called `testing`.
- **The stop gate's flow:** the stop hook runs the checks for the files this chat edited and answers
  a failure with a follow-up message. Cursor allows 3 such rounds (`loop_limit` in `hooks.json`); that
  limit is Cursor's, not hook state, and the hooks keep no round count.
- `harness/prompt-location` checks the harness APIs listed in `OPTION_APIS`
  (`rules/prompt-apis.utils.js`). A test compares it with `findInstructionApis`
  (`testing/instruction-apis.fake.js`), which reads the exported functions whose options carry
  `instructions`, and fails on a missing or a stale entry.
- `bootstrap-worktree.mjs` and `verify-worktree.mjs` are manual: nothing runs them for you. See the
  root README.

## The layout and reference checks

The layout check (`npm run layout`) holds the words to the code: the graph in `docs/overview.md` is current and drawn nowhere else, no doc or comment names a path in the old root `src/` (one starting `src/<workspace>`), source names no issue number, and no doc promises what an issue will do ("until" or "once" one lands). Say what is true now; history and plans live in the issue. An extension does not depend on `@sheavly/host` at run time: only as a dev dependency, for its tests. It also holds AGENTS.md and the skills to the code: every path, import, `npm run` script, `harness/*` rule and code name they put in backticks must exist (`scripts/rule-references.mjs`). A reference meant to point outside the repo goes in `scripts/rule-references.allowlist.json` with its reason; an entry nothing needs any more fails too.

## Harness impact

This development harness is the ESLint rules, file-kind policies and configuration, plus git guards and GitHub workflow checks; it is not the product runtime. Follow the `git` skill's harness-impact procedure at triage and again before submission: name what each check enforces, add missing enforcement with focused regression tests, and say plainly what stays review-only.
