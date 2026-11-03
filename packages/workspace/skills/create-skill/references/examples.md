# Examples

- Good descriptions
- Weak descriptions, and why
- User-only skills
- A complete skill

## Descriptions

The description is all the agent sees before it picks a skill. Each good one says what the skill
does, then when to use it, in the words a user would type.

### Good

```yaml
description: >-
  Extracts text and tables from PDF files, fills PDF forms and merges PDFs. Use when working with
  PDF files or when the user mentions PDFs, forms or document extraction.
```

```yaml
description: >-
  Writes commit messages from the staged diff, in the repo's conventional-commit format. Use when
  the user asks to commit, write a commit message, or describe staged changes.
```

```yaml
description: >-
  Builds a dashboard for the team's internal metrics with the house chart components. Use whenever
  the user mentions dashboards, charts, metrics or showing data, even without saying "dashboard".
  Not for one-off tables in a reply.
```

### Weak, and why

| Description                       | What's wrong                                                  |
| --------------------------------- | ------------------------------------------------------------- |
| `Helps with documents.`           | No concrete task and no trigger words: it matches nothing     |
| `I can review your pull requests` | First person; doesn't say when to use it                      |
| `Use this for the deploy flow.`   | Says when, not what: the agent can't tell if it fits the task |
| `Processes data.`                 | So generic it matches everything, or nothing                  |

## User-only skills

A skill with side effects, or one the user runs as a command, gets
`disable-model-invocation: true`. The agent then never sees it in the list, so its description
can describe the command for the user instead:

```yaml
name: release
description: Tags a release, writes the changelog and publishes the packages. Run as /release <version>.
disable-model-invocation: true
```

## A complete skill

A team's code review, with its standards in a reference file the agent reads only when reviewing:

```text
.agents/skills/code-review/
├── SKILL.md
└── references/
    └── standards.md
```

`SKILL.md`:

````markdown
---
name: code-review
description: >-
  Reviews code changes for bugs, security and the team's standards, and reports the findings by
  severity. Use when the user asks for a review, a second look at a diff or PR, or before opening
  a PR.
---

# Reviewing code

1. Read the whole diff first (`git diff main...HEAD`), then each changed file around its changes.
2. Check, in this order:
   - correctness and edge cases;
   - security: input validation, secrets, file and command access;
   - [the team's standards](references/standards.md);
   - whether the tests cover the change.
3. Report each finding as one line, most severe first:

```text
[high] src/auth.ts:42: the token is compared with ==, so timing leaks it. Use timingSafeEqual.
```

Say "no findings" rather than inventing minor ones: the team reads every line.
````

`references/standards.md` holds the naming, error-handling and testing rules. It is a separate
file so the agent reads it only when reviewing, and the team can extend it without touching the
steps.
