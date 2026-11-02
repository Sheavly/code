# Submit (push, open and update the PR)

In a stack, submit every layer with `gh stack submit --auto`, then set each PR's title and body
here from step 4 on ([stacks.md](stacks.md)).

1. Make sure everything that belongs in the PR is committed, the commits are in review order
   (`git log --oneline --reverse origin/main..HEAD`), and the branch is on current `main`
   (otherwise run [sync.md](sync.md) first).
2. **Review** the branch with [review.md](review.md) and settle its findings before anything is
   pushed.
   Then run the mechanical triggers of [harness.md](harness.md) against the diff: each one the
   branch hits needs its enforcement committed, before the push.
3. **Push**: `git push -u origin HEAD` the first time, `git push` after. After a fold or reshape
   while the PR is a draft ([fix.md](fix.md)), `git push --force-with-lease`.
4. **Open the PR** once, as a draft unless the user asked for it to be ready for review. Write the
   body to a file outside the repo and pass it with `--body-file`, so backticks and `$` aren't
   touched by the shell:

   ```bash
   gh pr create --draft --base main --head 123-provider-switch \
     --title "feat(loop): switch providers between turns" --body-file /tmp/pr-body.md
   ```

   - Title: `type(scope): subject`, no issue number ([conventions.md](conventions.md)). With a
     squash merge it becomes the one commit on `main`, so the type and scope describe the whole PR.
   - Body: the sections below, in this order, ending in `Closes #123`. `.github/pull_request_template.md`
     has the skeleton; a worked example is in [conventions.md](conventions.md). A stack layer
     that leaves the issue open ends with `Part of #123` instead, and its base is the layer below
     (`--base 123-switch-contract`).
   - Assign yourself if the user wants (`--assignee @me`); copy the issue's labels if they describe
     the PR (`--label`).

5. **Keep the body current.** Rewrite it when a commit adds or drops a concern, when commits are
   reshaped, or when review fixes are appended (list them under `## Commits`). Edit with
   `gh pr edit <n> --title … --body-file …`. The `Git format` check reruns on every edit.
6. **Mark it ready for review** only when the user says so: `gh pr ready <n>`. From then on fixes
   are appended, never folded ([fix.md](fix.md)); say so to the user when you mark it ready. If the
   repo uses a project board, offer to move the issue to its in-review status ([issues.md](issues.md)).
7. Report the PR link. The issue already lists the PR under Development (from `Closes #123`).

## PR body standard

Plain, factual English for a reviewer who hasn't followed the chat. No emojis, no hype ("robust",
"seamless"), no claims about checks that weren't run. Draw the why from the issue (preflight step 2) and the what from the diff (`git diff origin/main...HEAD`, `git log`).

- `## Why`: the problem, naming the issue (`#123`). For a sub-issue, name the parent and what this
  part does for it. In a stack, name the layer below (`Stacked on #45`) and what this layer adds.
- `## Commits`: the commits in review order, bottom up, one line each: the short SHA, the subject,
  and what to look at in it. Review fixes appended after review started go under a
  `Review fixes` line at the end, so a reviewer sees what is new since they last looked.
- `## What changes`: grouped by concern under bold headings that name the area and its path, e.g.
  **Hooks** (`.cursor/hooks/`), with a few bullets each. Name files and commands where they help
  the reviewer find things. Say what is deliberately left out.
- `## How to review`: read commit by commit (the PR's Commits tab, or `git show <sha>`), what to
  read carefully in each (logic, security-relevant files) and what to skim (lockfile, baselines,
  mechanical fixes).
- `## Size`: only when the diff is large. What most of the lines are, and the reviewable size.
- `## Before merging` (optional): manual steps outside the code, as a checklist.
- `## Harness impact`: one bullet per [harness.md](harness.md) trigger the diff hits, naming
  what enforces it (the rule, test or hook, and its commit), or `none: <reason>`. CI fails a body
  without it, with it empty, or with a bare `none`.
- `## Test plan`: a checklist. `[x]` for what was actually run on the current head (CI, local
  runs), `[ ]` for what is still to do. Include the Bugbot and security reviews of the current head
  ([review.md](review.md)) and what was left open by decision, and the real-model check's result
  (`npm run workbook -- check`: which checks, passed, passed on retry or failed), or why the branch
  needs none.
- Last line: `Closes #123`, alone on its line (or `Part of #123` for a stack layer that leaves the
  issue open). CI checks it names the branch's issue.
