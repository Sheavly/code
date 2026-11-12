# Merge into main

A PR lands as one squashed commit on `main`, titled with the PR title (GitHub adds ` (#45)`). The
scoped commits inside it are for review; they don't reach `main` one by one. The merge closes the
issue through the body's `Closes #123`.

A stacked PR lands with `gh stack merge`, which also lands every layer below it; follow
[stacks.md](stacks.md) ("Sync and merge") instead.

1. Ask which PR to merge, unless the user said or the branch has only one.
2. Check readiness:

   ```bash
   gh pr view <n> --json isDraft,reviewDecision,statusCheckRollup,title,body,mergeable,baseRefName,closingIssuesReferences
   ```

   - The base must be `main`. A stacked PR whose layer below has merged is retargeted first:
     `gh pr edit <n> --base main` (or `gh stack sync --prune`).
   - The PR must not be a draft. Mark it ready only if the user agrees: `gh pr ready <n>`.
   - Checks must pass (`Git format` included). Approval is needed if the branch requires it.
   - The title must follow the format: it becomes the commit on `main`. Fix it with
     `gh pr edit <n> --title …` before merging.
   - `closingIssuesReferences` must list the branch's issue, unless the body says `Part of #`
     (a stack layer); otherwise fix the body's `Closes #`.
   - If any check fails, stop and report; never bypass. If GitHub reports a conflict
     (`mergeable` is `CONFLICTING`), run [sync.md](sync.md) first.

3. Confirm with the user, then merge and clean up. That one confirmation covers removing this
   issue's remote branch, worktree and local branch (step 4), and nothing else:

   ```bash
   gh pr merge <n> --squash --delete-branch
   ```

4. Remove what the issue left behind, in this order, from outside the worktree being removed
   (`git worktree list` shows where each branch is checked out). `gh pr merge --delete-branch`
   can exit non-zero after the merge succeeded when the local branch is checked out in a
   worktree: check `gh pr view <n> --json state` before treating it as a failure.
   - Check first: the branch is the PR's own (named `123-<name>` for this issue), it is not
     `main`, and its tip equals the PR's head commit, so no commit that was never merged is
     thrown away. If any of that differs, stop and ask.

     ```bash
     gh pr view <n> --json headRefName,headRefOid
     git rev-parse 123-<name>
     ```

   - the worktree, if the issue has one, found by that branch in `git worktree list`:
     `git worktree remove <path>`, never with `--force`. A worktree with uncommitted changes is
     left, and the user told which one and why.
   - the local branch: `git branch -D 123-<name>`. `-D` is the one forced step, needed because a
     squash merge doesn't mark the branch merged; the tip check above is what makes it safe. A
     branch checked out in a worktree can't be deleted, so the worktree goes first.
   - the remote branch, if `--delete-branch` did not already remove it:
     `git push origin --delete 123-<name>`.
   - then update `main`: `git fetch origin main`, and `git merge --ff-only origin/main` only in a
     checkout that is already on `main`. Never switch branches in a checkout that is on something
     else or has uncommitted changes; say it is behind instead.

   Only this issue's own branch and worktree are removed: never `main`, another branch, another
   worktree or the user's own checkout. The git guard does not check deletions, so this rests on
   the check above. In a stack, remove a layer only after the PR above it has been retargeted to
   `main`, since deleting its remote branch earlier closes that PR.

5. Report the squashed commit on `main`, what was removed (remote branch, local branch, worktree)
   and what was left and why, and that the issue closed
   (`gh issue view 123 --json state`). For a sub-issue, say what's left of the parent's sub-issues
   and offer, in one line, to comment on the parent or close it ([issues.md](issues.md)).
