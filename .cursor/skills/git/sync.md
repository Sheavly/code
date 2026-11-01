# Sync with main

Use this to pick up new `main` commits. Branches stay on top of `main` by rebasing, never by
merging `main` in, so the commits stay in review order with no merge commits between them.

1. Commit or stash uncommitted work first.
2. `git fetch origin main`, then see what's new: `git log --oneline HEAD..origin/main`. If it's
   empty, there is nothing to do.
3. Rebase depends on the PR, like every rewrite ([fix.md](fix.md)):
   - **No PR, or a draft:** rebase and push the rewritten branch. A rebase with no other change
     needs no review ([review.md](review.md), step 1):

     ```bash
     git rebase origin/main
     git push --force-with-lease
     ```

   - **Ready for review:** a rebase rewrites every commit the reviewer has read, so only rebase
     when the PR needs it (a conflict GitHub shows, or checks that need the new `main`) and
     **ask the user first**. Otherwise leave it: the squash merge applies it on top of `main`.
4. A conflict stops the rebase at the commit that conflicts: resolve it in that commit's scope,
   keeping both `main`'s change and the commit's intent, then `git add <paths>` and
   `git rebase --continue` ([troubleshooting.md](troubleshooting.md)).
5. Run `npm run check` after a rebase that had conflicts.
