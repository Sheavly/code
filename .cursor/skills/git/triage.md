# Triage: does the request fit the issue, and where does it go?

Run this at the start of an issue chat, and again whenever a request moves to a new topic. Skip it
for follow-ups on work you already placed. Don't use it to second-guess every prompt.

## 1. Read the issue

`gh issue view 123 --json title,body,state,issueType,labels,blockedBy` (preflight step 2), and its
comments when the discussion matters. If GitHub can't be reached, say "couldn't read #123" and
continue from the user's description; never guess the issue's content.

Issues are often thin. Treat them as guidance about scope, not as a contract. If it has open
`blockedBy` issues, say so in the verdict: the work may need them first. If it has no "Done when"
criteria, propose them in the verdict before starting ([issues.md](issues.md), "What an issue is").

Its `area/*` labels (required, one per commit scope; [issues.md](issues.md), "Classify") say which
scopes the work should touch. When the planned commits need a scope the issue isn't labelled with,
say so in the verdict and propose the label: `Git format` fails the PR until the issue has it.

## 2. Judge the fit

- **Fits:** the request does what the issue describes, or is a step towards it.
- **Reasonable extension:** closely related work the issue doesn't mention (tests, a small refactor
  the change needs). Say so in one line and carry on.
- **Outside the issue:** a different feature or fix. **Stop and ask** whether to extend the scope
  or to open a separate issue (a new chat, branch and PR; [issues.md](issues.md)).

## 3. Place the work

Read the branch's commits with `git log --oneline --reverse origin/<base>..HEAD` (the base is `main`, or the layer below in a stack), its PR's state
(`gh pr view --json isDraft`) and which commit owns the files involved. Then pick the first row
that applies:

| Situation                                                  | Placement                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| No branch for this issue yet                               | New branch: [start.md](start.md)                                           |
| It belongs to the scope of a commit already made           | Fix that commit: [fix.md](fix.md) (fold on a draft, append once in review) |
| Same scope as the commit you're working on                 | The current commit                                                         |
| The next scope in the plan                                 | A new commit: [commit.md](commit.md)                                       |
| Part of the issue, but large or independent enough to land | **Ask:** a sub-issue with its own PR ([issues.md](issues.md))              |
| Large, and the parts depend on each other                  | **Ask:** a stack of PRs ([stacks.md](stacks.md))                           |

A dependency always points down, as the layers do (core ← providers, runtime ← tools ← loop ←
hosts): if the new code needs something, that something must be in the same commit or an earlier
one.

## 4. Report, then proceed

State the result in two or three lines before editing. For example:

> #12, "Switch providers between turns": fits. The contract goes in the core commit; the loop
> change is the next commit, `feat(loop): …`. Adding it now.

Then carry on. The only two cases that wait for the user are "Outside the issue" and "Ask" in the
table above.
