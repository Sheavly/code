# The quality gate and the dev hooks

```bash
npm run check            # the whole gate through turbo (turbo.json): each workspace's typecheck, lint, test, then the root's, plus prettier, knip, jscpd and the layout check
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

## The Cursor hooks (`.cursor/hooks.json`)

They run automatically:

- **After each Write**, the edited file is formatted with Prettier, then linted. If the hook says "Prettier reformatted the file", re-read the file before editing it again, since old `old_string` text may no longer match. The first edit of harness source in a chat injects "Backend only" and "Where code goes" from [layers.md](layers.md), and the first edit inside a workspace shows that workspace's README (once per workspace per chat). The first edit of a file a skill governs names that skill, then each of its guides that covers the file, once each per chat: each skill in `.agents/skills/` has a `harness.json` beside its `SKILL.md` with `governs` globs (or an empty list and a `manual` reason), optionally `lintRules`, `ruleFiles` and `guides`. A new skill needs one, and a test fails on a glob that matches no file. TypeScript written outside every workspace's `src/` (other than `NOT_SOURCE` in `layout.js`) is reported on the edit.
- **Before each shell command**, the shell guard (`guard-shell-commands.mjs`, its checks in `shell-guard.utils.mjs`) denies in-place shell editors (`sed -i`, `perl -pi`, `awk -i inplace`, scripted `vim`/`ex`/`ed`) on project files: those edits skip the hooks above and show no diff. Edit with the edit tools; read-only uses and files outside the project stay allowed. It snapshots the project before each command it allows; **after it**, `record-shell-writes.mjs` compares, records any changed files for the stop hook's gate, and reports a command that changed files and isn't a known writer (`SANCTIONED_WRITERS` in `shell-writes.utils.mjs`, grown only by the user) as a workaround. Add it to `DENIED_CASES` (`shell-guard-cases.utils.mjs`) and teach the guard the technique.
- **On stop**, typecheck and ESLint run through turbo (so cached results are reused), then Prettier check, knip, the layout check and jscpd, but only for a chat that edited or deleted project source in this checkout. Each chat records the files it edits (`.cursor/hooks/chat-files.utils.mjs`), and the gate holds it to those. A failure comes back as a follow-up message (up to 3 rounds): fix the cause in code, never by suppressing it. Once they pass, the docs nudge runs.
- **Subagents** (the Task tool) get no `beforeSubmitPrompt` of their own, so `record-subagent.mjs` (`subagentStart`) links each Task call to the chat that made it; a subagent's edits are its parent's to check, and the parent's stop hook waits while one still works.

## The layout and reference checks

The layout check (`npm run layout`) holds the words to the code: the graph in `docs/overview.md` is current and drawn nowhere else, no doc or comment names a path in the old root `src/` (one starting `src/<workspace>`), source names no issue number, and no doc promises what an issue will do ("until" or "once" one lands). Say what is true now; history and plans live in the issue. It also holds AGENTS.md and the skills to the code: every path, import, `npm run` script, `harness/*` rule and code name they put in backticks must exist (`scripts/rule-references.mjs`). A reference meant to point outside the repo goes in `scripts/rule-references.allowlist.json` with its reason; an entry nothing needs any more fails too.

## Harness impact

This development harness is the ESLint rules, file-kind policies and configuration, plus git guards and GitHub workflow checks; it is not the product runtime. Follow the `git` skill's harness-impact procedure at triage and again before submission: name what each check enforces, add missing enforcement with focused regression tests, and say plainly what stays review-only.
