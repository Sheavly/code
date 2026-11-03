# Start an issue

1. **Read the issue** (preflight step 2). If there is no issue yet, create it first
   ([issues.md](issues.md)).
2. **Triage** the request against it ([triage.md](triage.md)).
3. **Plan the commits**, in the order the work will be built, one scope each:
   - Lower layers first: `core`, then `providers`/`runtime`, then `tools`, then `loop`, then the
     hosts (`host`, `workbook`). A commit only uses what it or an earlier commit adds.
   - Tests go in the commit of the code they test.
   - A doc in `docs/` that describes a scope's change goes in that commit; a doc covering the
     whole feature can be the last commit (`docs: …`).
   - Unrelated work (a separate fix or refactor) belongs under its own issue and PR.
   - Present the plan as a list in review order, with the branch name.
   - If the plan is too big for one PR and its parts depend on each other, propose a stack: the
     plan's commits grouped into layers, one branch and PR each ([stacks.md](stacks.md)). Create
     it there instead of step 5.
4. **Check the starting point:** the working tree must be clean (or the user agrees to carry
   changes over), then `git fetch origin main`.
5. **Create the branch** from `main`, named for the task, not for a scope. `gh issue develop`
   links it to the issue:

   ```bash
   gh issue develop 123 --name 123-provider-switch --base main --checkout
   ```

   Without network access, `git switch -c 123-provider-switch origin/main` makes the same branch;
   GitHub links it once the PR's `Closes #123` does.

6. **Offer** to assign the issue (`gh issue edit 123 --add-assignee @me`) or move it on the project
   board ([issues.md](issues.md)); do it only if the user says yes.
7. **Report** the planned commits and the branch. The next step is to write the first scope's code,
   then `/git commit`. Open the PR as a draft once the first commit is pushed
   ([submit.md](submit.md)), so CI runs from the start.
