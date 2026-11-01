# Stacked PRs

A stack is a chain of PRs where each one is based on the branch below it, and the bottom one on
`main`. Use one when a change is too big to review as one PR but its parts depend on each other, so
they can't each be based on `main`: the core contract, then the loop change that uses it, then the
host UI on top. Each layer is reviewed (and can be approved) on its own while the ones below are
still open. Independent parts don't need a stack: give them sub-issues with their own PRs on `main`
([issues.md](issues.md)).

Stacks are allowed everywhere the workflow speaks of "the PR": the git guard, the `Git format`
check and every procedure here accept a PR based on another issue branch.

## Layers and issues

Every layer is a normal branch, `<issue>-<kebab-name>` ([conventions.md](conventions.md)), with
its own PR in the usual format. Two ways to tie layers to issues:

- **One issue, several layers** (the common case): every layer is a branch for the same issue
  (`123-switch-contract`, `123-switch-loop`, `123-switch-ui`). Lower layers say `Part of #123`;
  the top layer, which finishes the work, says `Closes #123`.
- **One sub-issue per layer:** each layer's branch is for its own sub-issue and its PR says
  `Closes #<sub-issue>`. Record the order as dependencies, each layer blocked by the one below
  (`gh issue edit 125 --add-blocked-by 124`; [issues.md](issues.md)), so the issues show it too.
  Name every issue in the chat ("#123, #124 and #125"), since the git guard only lets an agent
  create branches for issues the chat has named.

Commits inside each layer follow the usual rules: one scope each, in build order, `Refs: #<issue>`
naming that layer's branch issue.

## Create a stack

With the `gh stack` extension ([setup.md](setup.md)), which links the PRs as a stack on GitHub:

```bash
gh stack init --base main 123-switch-contract    # bottom layer, based on main
# … commit the layer ([commit.md](commit.md)) …
gh stack add 123-switch-loop                     # next layer, on top of the current one
# … commit …
gh stack submit --auto                           # push every layer, open draft PRs
```

`gh stack submit --auto` writes its own titles; fix each PR's title and body afterwards with
`gh pr edit <n> --title … --body-file …` ([submit.md](submit.md)). In each body, name the layer
below (`Stacked on #45`) under `## Why`.

Without the extension, plain git and `gh` make the same stack, just without GitHub's stack view:

```bash
git switch -c 123-switch-loop 123-switch-contract
gh pr create --draft --base 123-switch-contract --head 123-switch-loop --title … --body-file …
```

## Rules

- Always pass the non-interactive form: `gh stack view --json`, `submit --auto`,
  `merge <pr> --yes --squash`, `checkout` with a stack number, PR number or branch, and
  `up`/`down`/`top`/`bottom` instead of `switch`. Never run `gh stack modify`; it is a TUI. The git
  guard denies the interactive forms.
- Name a new layer: `gh stack add <branch>`. Stage with `git add <path>…` first; never
  `gh stack add -A`/`-u`.
- Before every push of new work, review the layers that changed ([review.md](review.md)), each
  against the layer below it (`Base Branch: origin/<lower-branch>`).
- Rewriting follows [fix.md](fix.md) per layer, with one exception: restacking an upper layer onto
  a changed lower one (`gh stack rebase --upstack`, `gh stack push`) is allowed even once its PR is
  ready for review, since only the base moved. Say so in that PR's body under `Review fixes`.
- Don't redirect `gh stack` output (`2>&1`, `| tail`); its exit code is what matters.
- A `gh stack` exit code other than 0 means stop and read the table below. Exit 0 with
  `Sync aborted` is not a success.

## Fix a lower layer

1. Commit or stash work in progress.
2. Find the owning layer: `git log --oneline main..HEAD -- <path>`; go there with
   `gh stack checkout <branch>`.
3. Commit the fix there ([commit.md](commit.md), [fix.md](fix.md)), then replay the layers above
   and push:

   ```bash
   gh stack rebase --upstack
   gh stack top
   gh stack push
   ```

## Sync and merge

- Pick up `main` and clean up merged layers: `gh stack sync --prune`, then confirm with
  `gh stack view --json` that `needsRebase` is false everywhere.
- Merge: check each PR up to the target (not a draft, checks green, title in format, the right
  `Closes`/`Part of` line), confirm with the user, then `gh stack merge <pr> --yes --squash`. It
  lands that PR and every unmerged one below it, each as one squashed commit on `main`. Then
  `gh stack sync --prune`.
- Without the extension, merge bottom up: `gh pr merge <bottom> --squash --delete-branch`, then
  `gh pr edit <next> --base main`, rebase the next layer onto `main` ([sync.md](sync.md)), and
  repeat.
- If the local tracking is lost (a deleted worktree, a new machine): `gh stack checkout <stack-number>`
  imports it from GitHub.

## Exit codes

| Code | Meaning                     | Do                                                                                           |
| ---- | --------------------------- | -------------------------------------------------------------------------------------------- |
| 1    | Generic error               | Read stderr                                                                                  |
| 2    | Not in a stack              | The branch isn't stacked; use the rest of this skill                                         |
| 3    | Rebase conflict             | `gh stack rebase`, resolve, `git add <paths>`, `gh stack rebase --continue`, `gh stack push` |
| 4    | GitHub API failure          | `gh auth status`, then retry                                                                 |
| 6    | Branch is in several stacks | `gh stack checkout <stack-number>`                                                           |
| 7    | Rebase already in progress  | `gh stack rebase --continue` or `--abort`                                                    |
| 8    | Stack file locked           | Another `gh stack` is running; retry after ~5 s. Never delete locks.                         |
| 9    | Stacked PRs unavailable     | Stop and tell the user                                                                       |

GitHub refuses to unstack or reorder a stack while it holds merged PRs. Reordering one means
closing its PRs and opening a new stack; ask the user before doing that.
