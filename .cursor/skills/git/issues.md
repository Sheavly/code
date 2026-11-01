# Issues (GitHub only)

Everything about work tracking is GitHub: issues in this repo, their types, sub-issues and
dependencies, a few labels, and optionally a GitHub Project. There is no Jira or other tracker.
Everything goes through `gh` (2.94 or later, [setup.md](setup.md)).

The agent changes an issue only when the user asks. Show the text of a new issue or comment to the
user before posting it, unless they dictated it.

## What an issue is

One issue is one independently shippable unit of work, normally one PR. It stands on its own: a
reader understands the problem, why it matters and when it is done without reading anything else.

- **Title:** plain language, what should be true afterwards ("Lock concurrent edits to the same
  file"), not a commit header; the PR title has the `type(scope): subject` format. A title with
  "and" in it is usually two issues.
- **Body:** the issue form's sections (Why, What, Done when, Notes). "Done when" is a checklist of
  testable outcomes, never "it works". More than about ten criteria, or several concerns, means
  it should be split.
- **Detail grows with priority:** a backlog issue can be a few lines; it gets its full "Done when"
  before work starts ([triage.md](triage.md)).

## Classify: types, then labels

- **Issue type** (one per issue, defined for the whole Sheavly organization): `Task` (a piece of
  work), `Bug` (something behaves wrongly), `Feature` (a larger piece of functionality, usually a
  parent with sub-issues). Set it on every issue (`--type Task`); the issue forms set it already.
  Find work with `gh issue list --type Bug`.
- **Labels** only for what a type can't say. Use the repo's defaults (`documentation`,
  `good first issue`, `help wanted`, `question`, `duplicate`, `invalid`, `wontfix`) and, if needed,
  `area/<scope>` labels named after commit scopes (`area/loop`, `area/tools`). Never labels for
  status or priority: status is read from GitHub (below), and priority belongs in a project field.

## Create an issue

From an issue form (`.github/ISSUE_TEMPLATE/`: `task.yml`, `bug.yml`, `feature.yml`). Write the body to a file
outside the repo and pass it with `--body-file`:

```bash
gh issue create --type Task --title "Lock concurrent edits to the same file" --body-file /tmp/issue.md
```

## Break it down: sub-issues

Work too big for one PR becomes sub-issues of a parent (usually a `Feature`), each with its own
branch and PR. When the parts depend on each other, those PRs can form a stack, one layer per
sub-issue ([stacks.md](stacks.md)).

```bash
gh issue create --type Task --parent 123 --title "…" --body-file /tmp/child.md   # a new child
gh issue edit 123 --add-sub-issue 124,125                                          # existing ones
gh issue view 123 --json subIssues,subIssuesSummary                                # progress
```

GitHub shows the parent's progress from its sub-issues. Close the parent (with the user's say) once
its sub-issues are done; nothing closes it automatically.

## Dependencies: blocked by, blocking

When one issue can't start or finish before another, record it, so the blocked one shows as
blocked on the issue list and any board:

```bash
gh issue edit 125 --add-blocked-by 124
gh issue view 125 --json blockedBy,blocking
```

Use dependencies for order between issues (a stack's layers on sub-issues, a feature waiting on a
fix); sub-issues are for "part of". Don't write "depends on #124" in prose instead.

## Linking

Done by the workflow, never by hand:

- the branch `123-<name>` (`gh issue develop`) appears under the issue's Development panel;
- every commit's `Refs: #123` shows the commit in the issue's timeline;
- the PR body's `Closes #123` links the PR to the issue and closes it when the PR merges into
  `main`; a stack layer's `Part of #123` links it without closing ([stacks.md](stacks.md)).

## Workflow status

The issue's status is read from GitHub, not kept in labels:

| Status      | What shows it                                                       |
| ----------- | ------------------------------------------------------------------- |
| Open        | the issue is open, with no branch or PR                             |
| Blocked     | it has an open `blockedBy` issue                                    |
| In progress | it has a branch, or a draft PR (Development panel)                  |
| In review   | its PR is ready for review                                          |
| Done        | the issue is closed: its PR merged (`Closes #123`)                  |
| Not planned | closed as not planned (`gh issue close 123 --reason "not planned"`) |

Assign the issue to whoever works on it when they start (`gh issue edit 123 --add-assignee @me`).

## Optional: a GitHub Project

A project board adds what issues alone lack: one Status field, plus Priority (single select), Size
(number) and Iteration fields. If the repo uses one:

- its Status is the one source of truth for status; it mirrors the table above;
- turn on its built-in workflows: add new issues from this repo automatically, set Done when an
  issue closes or a PR merges, archive old Done items;
- move items only when the user asks: `gh project item-list <n> --owner Sheavly --format json` finds
  the item, `gh project item-edit --id <item> --project-id <id> --field-id <field> --single-select-option-id <option>`
  sets a field. Option names come from the project's own fields (`gh project field-list`); never
  assume them. If none clearly matches, list them and ask.

`gh project` needs the `project` scope ([setup.md](setup.md)).

## Triage and grooming

- **New issues:** give each a type, check it fits "What an issue is" above, and either accept it,
  ask for what's missing (comment, `question` label), mark a duplicate (`duplicate`, close with a
  link) or close it as not planned. Do this only when the user asks for triage.
- **Grooming (periodically, when the user asks):** list open issues
  (`gh issue list --state open --json number,title,issueType,labels,updatedAt,subIssuesSummary,blockedBy`),
  and propose, as a list for the user to accept: duplicates and finished or obsolete issues to
  close, issues to split, missing types or dependencies, parents whose sub-issues are all done.
  Ask "still relevant?" on a stale issue instead of closing it. Apply only what the user accepts.

## Comments

Short and factual. Typical comments:

- after [submit.md](submit.md): nothing; the PR already shows in the Development panel.
- after [merge.md](merge.md), for a sub-issue's parent: "Merged #45 (provider switch contract); 2
  of 3 sub-issues done."

```bash
gh issue comment 123 --body-file /tmp/comment.md
```
