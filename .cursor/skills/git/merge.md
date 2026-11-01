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

3. Confirm with the user, then merge:

   ```bash
   gh pr merge <n> --squash --delete-branch
   ```

4. Clean up locally: `git switch main && git pull --ff-only`, then ask before deleting the local
   branch (`git branch -D 123-<name>`; `-D` because a squash merge doesn't mark it merged).
5. Report the squashed commit on `main` and that the issue closed
   (`gh issue view 123 --json state`). For a sub-issue, say what's left of the parent's sub-issues
   and offer, in one line, to comment on the parent or close it ([issues.md](issues.md)).
