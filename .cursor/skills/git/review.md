# Review (before every push of new work)

[commit.md](commit.md), [fix.md](fix.md) and [submit.md](submit.md) run this before they push, and
the user can run it alone (`/git review`). Lint, types and CI check the mechanics; this catches what
they can't: obvious bugs, security holes, code in the wrong place, and files that have started
doing two jobs. Findings are fixed before the push, so a reviewer never reads them.

1. **Commit first.** The review reads the branch against `main`, but its findings are placed by
   commit, so anything meant for the push is committed ([commit.md](commit.md)). Skip the whole
   review when there is nothing new to read: a push that only rebases onto `main`
   ([sync.md](sync.md)), or a head this chat already reviewed.
2. **Launch both reviewers in parallel**, one subagent each, in the same message and not in the
   background, both against `origin/main`.

   A `bugbot` subagent (`description: "Bugbot"`):

   ```text
   Full Repository Path: <absolute path of this checkout>
   Diff: branch changes
   Base Branch: origin/main
   Custom Instructions: Besides bugs, review against .cursor/skills/working-in-sheavly-harness/SKILL.md:
   the layers (imports only point down), file kinds and where code goes, interrupts leaving history
   valid, and a new `ignore` in knip.json or .jscpd.json (there are no baselines). For each changed file,
   ask whether it still has one reason to change; lint can't judge that.
   ```

   A `security-review` subagent (`description: "Security Review"`):

   ```text
   Full Repository Path: <absolute path of this checkout>
   Diff: branch changes
   Base Branch: origin/main
   Custom Instructions: Besides the usual review, check that file access goes through Workspace
   (no escapes via symlinks or `..`), `.env*` files are never read or written, commands go through
   the process runner and its allow list, external input is validated with zod, and no API key
   reaches logs, events or history.
   ```

   If a subagent type isn't available, run that review yourself on the same diff with the same
   instructions and report it the same way.

3. **Report the findings** as one table (Reviewer, Severity, Location `file:line`, Finding),
   highest severity first, or "Bugbot and Security Review found nothing".
4. **Handle each finding:**
   - A clear fix: commit it to the commit that owns the file, folded on a draft or appended once
     the PR is ready ([fix.md](fix.md)), but don't push yet; the push comes after the second round.
   - A file with two responsibilities: propose the split and ask; it can reshape the plan.
   - A judgment call, or a finding you think is wrong: ask the user; don't fix it silently and
     don't dismiss it silently. A security finding is never left open without the user's say.
   - Outside the issue: leave it, tell the user, and offer to open an issue for it
     ([issues.md](issues.md)).

   After fixing, run the checks the fixes affect and run both reviewers once more. Stop after that
   second round and give the user what is left, rather than looping.

5. **Real-model check**, when the branch changes what a run does (the source `workbook/run-sources.json`
   lists: the host, loop, runtime, tools, providers and core packages, and the app's `src/`):
   `npm run workbook -- check`, after the reviews' fixes. It runs only the checks whose `areas` the
   branch changed, retries a failure once, and lists changed source no check covers: add or
   extend a prompt's `check` for that (`workbook/README.md`). It's a local, on-demand command and
   never runs in CI: every run is a paid model call. Run it once when the change is done, not on
   every commit, and not for lint, hooks, scripts or docs. A failure is fixed like a finding; one
   that passed only on its retry is reported, not ignored.
6. Push only when nothing is open, or the user has said to push anyway. Mention the outcome in the
   report ("Bugbot: 2 fixed, 1 left by decision; Security Review: none") so the PR body's test
   plan can list it.
