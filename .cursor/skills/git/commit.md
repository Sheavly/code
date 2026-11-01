# Commit

1. `git status --short` and `git diff` (and `git diff --staged`): see what changed.
2. **Check ownership** against the planned commits ([start.md](start.md), step 3) and the
   placement table in [triage.md](triage.md). A commit holds one scope:
   - Changes for the scope you're working on: this commit.
   - Changes that belong to a commit already made (a core fix while you're on loop): stage them
     separately and follow [fix.md](fix.md).
   - Changes for several scopes at once: split them into one commit per scope, in plan order
     (`git add <paths>` per scope, `git add -p <path>` for a file that mixes two).
   - Unrelated changes: leave them uncommitted and tell the user.
3. **Stage the named files** for this commit: `git add <path> <path>…` (`git add -p <path>` is fine
   for hunks). Never `git add -A`/`.`.
4. **Check** what the commit touches: `npm run check` (or at least `npm run typecheck` and the
   tests of the scope) so every commit builds on its own.
5. **Write the message** in the format in [conventions.md](conventions.md). Pass it with a heredoc;
   a commit without `-m`/`-F` opens an editor and hangs:

   ```bash
   git commit -m "$(cat <<'EOF'
   feat(loop): switch providers between turns

   The switch is read before each model call, so a change applies from the next turn.

   Refs: #123
   EOF
   )"
   ```

   - The scope is the package or `src/` folder; leave it out for root tooling.
   - The subject is imperative and lowercase, with no full stop, and at most 72 characters in the
     header line. The git guard refuses an agent commit that breaks the format, before it is made.
   - The body explains why, when that isn't obvious.
   - The `Refs:` value is the branch's issue. Never `Closes` in a commit.

6. If a hook fails, fix what it reports and make a **new** commit. Never `--no-verify`.
7. Push the branch so CI and the PR follow. With no PR yet, go to [submit.md](submit.md): it
   reviews, pushes and opens the draft PR. Otherwise run [review.md](review.md), then `git push`.
