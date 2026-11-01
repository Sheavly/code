# Setup (once per machine, and once per repo)

```bash
gh --version                            # 2.94 or later: issue types, --parent, --blocked-by
gh auth status                          # logged in with access to this repo (repo scope)
gh repo view                            # gh resolves this repo; if not: gh repo set-default <owner>/<repo>
git config rerere.enabled true          # replay conflict resolutions when a rebase repeats them
```

**Several GitHub accounts.** `gh` uses its active account for every repo. If that account can't
see this one (`gh repo view` says not found, while `git fetch` works through an SSH host alias),
either switch (`gh auth switch --user <account>`) or, to leave the active account alone, run `gh`
with that account's token for this repo only:

```bash
export GH_TOKEN=$(gh auth token --user <account>)
```

For the GitHub project board (optional): `gh auth refresh -s project`.

For stacked PRs with GitHub's stack view (optional; plain git and `gh pr create --base` work
without it): `gh extension install github/gh-stack` ([stacks.md](stacks.md)).

Once per repo, in GitHub's settings (a person does this, not an agent):

- **Pull requests:** allow squash merging only, with "Default to pull request title" for the
  commit message; turn on "Automatically delete head branches".
- **Branch protection on `main`:** require a pull request, the `PR title, body and branch`
  check from the `Git format` workflow, and the `npm run check` check from the `Check` workflow.
  Don't restrict which branches a PR may target: stacked PRs
  are based on issue branches.
- **Issues:** on, with the forms in `.github/ISSUE_TEMPLATE/` (`task.yml`, `bug.yml`, `feature.yml`).
- **Issue types** (organization settings, Planning → Issue types): `Task`, `Bug` and `Feature`,
  which the forms and [issues.md](issues.md) use.
