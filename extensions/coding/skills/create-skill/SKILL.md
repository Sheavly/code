---
name: create-skill
description: >-
  Creates or improves an agent skill (a folder with a SKILL.md) in this project or for the user.
  Use when the user asks to create, write or update a skill, turn a workflow or this conversation
  into a skill, make the agent remember how to do a task, or asks how a SKILL.md is written, even
  if they don't say "skill". Not for AGENTS.md rules that apply to every task.
---

# Creating a skill

A skill teaches the agent a task it would otherwise get wrong or redo from scratch. Before every
turn the agent sees only each skill's `name` and `description`. It reads `SKILL.md` with
`read_skill` when a description fits the task, and the files `SKILL.md` links to only when it
needs them. The user can also run any skill directly by mentioning `/<name>` anywhere in a message.

The skill is written for another agent, as smart as you but without this conversation. Give it
what it can't know: the user's steps, conventions, file locations, mistakes to avoid. Leave out
what any capable agent already knows.

## 1. Capture what the skill is for

If the conversation already shows the workflow ("turn this into a skill"), take it from there:
the steps taken, the tools used, the corrections the user made, the output they accepted. Then
fill the gaps by asking, one or two questions at a time:

- What should the agent do differently with the skill than without it?
- What would the user say, or be working on, when it should be used? When should it not be used?
- Does it produce a specific output (a file, a format, a message)? Get one real example.
- Should only the user run it? Do that for skills with side effects or a fixed workflow
  (deploying, releasing, posting).

If the user gives exact wording for the skill, use it verbatim. If the task is a standing rule
for every task ("always use npm"), it belongs in AGENTS.md, not a skill: say so.

## 2. Pick the name and the place

The name is lowercase words joined by single dashes, at most 64 characters, and the same as the
folder's name. Pick an action or activity (`review-pr`, `writing-migrations`), not `helpers` or
`utils`. Check the skills list first. A skill with an existing one's name replaces it from the
project or `~/.sheavly/skills/`; in `~/.agents/skills/` it loses to a built-in skill.

| Folder                      | Who gets it                                                   |
| --------------------------- | ------------------------------------------------------------- |
| `.agents/skills/<name>/`    | Everyone in this repo; other agents read it too (the default) |
| `.sheavly/skills/<name>/`   | This repo, in this harness only                               |
| `~/.agents/skills/<name>/`  | The user, in every project and every agent                    |
| `~/.sheavly/skills/<name>/` | The user, in every project, in this harness only              |

The file tools only write inside the workspace. For a skill in the user's home folder, give the
user the path and the full contents of each file to create, and don't write it yourself.

## 3. Write the description

The description is the only part the agent sees before it decides to use the skill, so it
decides whether the skill is ever used. Agents tend to use skills less often than they should,
so be specific and a little insistent:

- Start with what the skill does, in the third person ("Reviews…", not "I review…" or "You can…").
- Then say when to use it, with the words the user would actually type, including indirect ones.
- If a near-miss task should not use it, say so in one short clause.
- Keep it under 1,024 characters. All "when to use" information goes here, not in the body.

See [the examples](references/examples.md) for good and weak descriptions.

## 4. Write the body

```markdown
---
name: review-pr
description: >-
  Reviews a pull request against the team's checklist (tests, naming, error handling) and
  writes the review as PR comments. Use when the user asks for a review, a second look at a
  change, or before opening a PR.
---

# Reviewing a pull request

1. Read the diff against `main`.
2. Check each item in [the checklist](references/checklist.md).
3. ...
```

- **Match the freedom to the task.** Give guidance where many approaches work (a review), and
  exact steps or a command where one mistake is costly (a migration). Give one default, with an
  escape hatch if needed, rather than a list of options.
- **Explain why.** "Run the tests first: CI rejects PRs that change snapshots" works better than
  "ALWAYS run the tests". If you're writing NEVER in capitals, write the reason instead.
- **Show the output.** When a format matters, give a template or one concrete input and output.
  For templates, examples, step checklists, branching workflows and validation loops, see
  [the writing patterns](references/patterns.md).
- **Keep it short.** Keep `SKILL.md` well under 500 lines, and put long reference material (schemas,
  API notes, per-variant details) in files next to it, in `references/`. Link each one directly
  from `SKILL.md` and say when to read it, keeping links one level deep. A reference file longer
  than about 100 lines starts with a table of contents.
- **Scripts only when needed.** Put code in `scripts/` only when it has to run the same way every
  time. Test it, make its errors say what to do next, and say whether the agent runs the script
  or reads it. Files used in the output go in `assets/`.
- **Keep it stable.** Use the same term for one thing throughout, forward slashes in paths, and
  nothing that goes stale ("after March", "the new API"); an old way still needed goes in an
  "Old patterns" section at the end.

The frontmatter needs only `name` and `description`; add `disable-model-invocation: true` for
user-only skills. Don't add a README or changelog to the folder: everything there is for the agent.
For a whole skill folder, with `SKILL.md` and its reference files, see
the "A complete skill" section of [the examples](references/examples.md).
A skill does only what its description says, never anything the user wouldn't expect.

## 5. Check it, then hand it over

- The frontmatter opens and closes with `---`, and `name` matches the folder.
- `SKILL.md` is well under 500 lines, every file it links to exists and is linked from `SKILL.md`
  itself, and the same thing has the same name throughout.
- Never write into `extensions/coding/skills/`: that folder holds the skills the harness ships.
- Read the description as if it were all you knew. Would you pick this skill for two or three
  realistic requests, and skip it for a near miss? Rewrite it until the answer is yes.
- If the user wants it tested, run a realistic request in a sub-agent (`start_agent`, which
  sees the same skills list) and see whether it reads the skill and follows it. Improve whatever
  it missed or misread.
- Tell the user where the skill is, that it shows up in the skills list from the next turn (unless
  it's user-only), and that they can run it with `/<name>`.
