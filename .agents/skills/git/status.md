# Status

1. `git status --short --branch`, and the branch's PR:
   `gh pr view --json number,title,body,isDraft,reviewDecision,statusCheckRollup,mergeable,closingIssuesReferences,url`.
   No PR: say which branch you're on and whether it's a legacy branch (no issue number). If
   `gh stack view --json` exits 0, the branch is in a stack: report every layer bottom up (branch,
   PR, base, state, `needsRebase`), and check each the same way.
2. List the commits in review order: `git log --format='%h %s' --reverse origin/<base>..HEAD`,
   where the base is `main` or the layer below.
3. Check the formats ([conventions.md](conventions.md)), since someone may have worked by hand:
   - the branch name (`<issue>-<kebab-name>`);
   - the PR title, and the body against the standard in [submit.md](submit.md): sections present,
     `## Commits` matching the commits, and `Closes #123` (or `Part of #123` in a stack) naming the
     branch's issue (the CI check, locally:
     `PR_TITLE=… PR_BODY=… PR_AUTHOR=… BASE_REF=… HEAD_REF=… node scripts/check-git-format.mjs`);
   - each commit (`git log --format=%B origin/main..HEAD`) for the header format and a `Refs:`
     footer naming the branch's issue, and no `Closes` in a commit. CI checks only the PR; commit
     format matters for review.
4. Check the shape of the commits:
   - one scope each: a commit whose files span several packages or `src/` folders
     (`git show --stat <sha>`) should be split;
   - fixes out of place: on a draft, a commit that fixes or finishes work from an earlier commit
     belongs folded into that commit;
   - order: a commit that uses something a later commit adds.
5. The issue: `gh issue view <n> --json state,assignees,labels`. Flag an issue closed while its PR
   is open, or a PR whose `closingIssuesReferences` is empty.
6. Report: branch, issue and its state, PR and its state, draft or ready, review decision, checks
   (passing, failing or pending), whether `main` has moved (`git log --oneline HEAD..origin/main`),
   and the commit list with any format or shape findings.
7. Suggest the next step, in this order of priority:
   - uncommitted changes: `/git commit`;
   - the PR title or body off the standard: `/git submit` rewrites it;
   - a pushed agent commit off the format, or commits out of shape on a draft: say which, and ask
     before rewriting ([fix.md](fix.md));
   - a conflict with `main`: `/git sync`; a stack layer that needs a rebase: [stacks.md](stacks.md);
   - a pushed branch without a PR: `/git submit`;
   - the PR approved and green: `/git merge`.

Read-only. Change nothing.
