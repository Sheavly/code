# Troubleshooting

## Rebase conflicts

A rebase (a fold, a reshape or a sync) stops at the commit that conflicts and lists the paths.

1. Resolve each path so the commit keeps its own intent and the change it conflicts with survives.
   If that isn't clear, stop and ask the user.
2. A conflict in `package-lock.json` is never resolved by hand: take `main`'s side, finish the
   rebase, then run `npm install` in the commit that changed `package.json` ([fix.md](fix.md),
   "Fold").
3. `git add <resolved paths>`, then `git rebase --continue`. Repeat for each commit that stops.
4. `git rebase --abort` restores the branch as it was before the rebase. With `rerere` enabled
   ([setup.md](setup.md)), a resolution repeats itself the next time the same conflict comes up.

## Push refused

- `rejected … (fetch first)` or `stale info` with `--force-with-lease`: someone else pushed to the
  branch. `git fetch`, look at their commits (`git log HEAD..@{u}`), then rebase onto them
  (`git rebase @{u}`) instead of overwriting them. Never fall back to `--force`.
- `rejected … (non-fast-forward)` on a plain `git push` after a fold or reshape: that is expected;
  push with `--force-with-lease`, and only while the PR is a draft.

## gh can't find the repository

`gh` reads the repo from `origin`. With an SSH host alias (`git@personal.github.com:…`), `gh` may
not map it to github.com: run `gh repo set-default <owner>/<repo>` once, or pass `--repo
<owner>/<repo>`. If it still says not found, the active `gh` account can't see the repo: use the
account that can ([setup.md](setup.md), "Several GitHub accounts"). Check with `gh repo view`.

## The issue didn't close on merge

Closing keywords only act on PRs merged into the default branch, and only from the PR body (or a
commit message). Check `gh pr view <n> --json closingIssuesReferences`; if it's empty the `Closes
#123` line was missing or malformed. Close the issue by hand with a comment naming the PR, if the
user agrees.
