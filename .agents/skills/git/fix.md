# Fix an earlier commit

Use this for review feedback, or a missed change that belongs to a commit already made (a core
change while you're on loop). How it goes in depends on whether anyone may already have read the
commit:

| The PR is…                         | The fix…                                           |
| ---------------------------------- | -------------------------------------------------- |
| not opened yet, or a draft         | is folded into the commit it belongs to ("Fold")   |
| ready for review (or under review) | is a new commit on top ("Append"); never a rewrite |

That way a reviewer never re-reads a commit they already reviewed.

## Fold (no PR, or a draft PR)

1. Find the owning commit: `git log --oneline --reverse origin/main..HEAD -- <path>` lists the
   commits that touched the file; pick the one whose scope it is.
2. Stage only the fix (`git add <path>` or `git add -p <path>`) and commit it as a fixup of that
   commit:

   ```bash
   git commit --fixup=<sha>
   ```

3. Fold it in, without an editor:

   ```bash
   GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash origin/main
   ```

   A conflict means a later commit touched the same lines: resolve it so both commits keep their
   intent, `git add <paths>`, then `git rebase --continue` ([troubleshooting.md](troubleshooting.md)).

4. Run `npm run check` and [review.md](review.md) (unless you're in its own fix round), then push
   the rewritten branch with `git push --force-with-lease`. Never `--force`.

## Append (ready for review)

1. Make the fix and commit it as a new commit on top, scoped to what it fixes, with a body that
   says what it answers:

   ```bash
   git commit -m "$(cat <<'EOF'
   fix(loop): give an interrupted tool call its placeholder result

   Review: an abort between the call and its result left history without a tool message.

   Refs: #123
   EOF
   )"
   ```

2. Run [review.md](review.md) (unless you're in its own fix round), then `git push`. Never amend,
   fixup-and-squash, rebase or force-push once the PR is ready for review; the squash merge tidies
   the history on `main` anyway.
3. If the fix changes what the PR does, update its body ([submit.md](submit.md), step 5).

## Reshape the commits (draft only)

Reordering, splitting or merging commits, or moving a change to the right scope's commit, rewrites
the branch. Do it only while the PR is a draft, and **ask the user first**.

1. Tag the current head so it can be restored: `git tag backup/<branch> HEAD`.
2. Write the new order as a rebase todo file outside the repo (`pick <sha> <subject>` per line, in
   review order; `fixup <sha>` folds a commit into the one above it), then run it without an editor:

   ```bash
   GIT_SEQUENCE_EDITOR="cp /tmp/rebase-todo" git rebase -i origin/main
   ```

3. Confirm nothing was lost: `git diff backup/<branch> HEAD` must be empty unless the reshape was
   meant to change content. Run the checks and [review.md](review.md), then
   `git push --force-with-lease`.
4. Rewrite the PR body's commit list ([submit.md](submit.md), step 5).

Moving work between two issues' PRs copies commits between branches: that is a cherry-pick, and
needs the user to write "allow cherry-pick" first.
