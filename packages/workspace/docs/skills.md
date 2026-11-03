# Skills

A skill is a set of instructions for a specific task, which the agent reads only when the task needs it. Unlike AGENTS.md, a skill takes up no context until it is read, so a project can have many. The format is the one Cursor, Claude and Codex use, so existing skills work unchanged.

## The format

Each skill is a folder holding a `SKILL.md`, which can link to other files in the same folder:

```markdown
---
name: review
description: Reviews a change against the checklist. Use before opening a PR.
disable-model-invocation: false
---

Read [the checklist](checklist.md), then …
```

| Field                      | What it does                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `name`                     | Required. Lowercase words joined by dashes, the same as the folder's name.                     |
| `description`              | Required. What the skill is for and when to use it: the model decides from this alone.         |
| `disable-model-invocation` | `true` keeps the skill out of the model's list. Only the user runs it (`/<name>` in the chat). |

Other fields, such as `paths`, `metadata` or `environments`, are read but not used. The
frontmatter is the YAML that skills use: `key: value` lines, `>-` / `|` text across lines, and
`- item` lists.

## Where skills are found

| Where                        | Scope    |
| ---------------------------- | -------- |
| `<project>/.sheavly/skills/` | project  |
| `<project>/.agents/skills/`  | project  |
| `~/.sheavly/skills/`         | user     |
| `packages/workspace/skills/` | built-in |
| `~/.agents/skills/`          | user     |

When two skills have the same name, the first one in this table wins, and the chat says at start
which skill is hidden by which. `.agents/skills/` is the folder other agents read too.
`~/.agents/skills/` comes after the built-in skills because other tools install their own skills
there: Cursor's `create-skill`, for example, would otherwise replace this harness's, and the
agent would follow Cursor's paths. A project's skills, or your `~/.sheavly/skills/`, still
replace a built-in one on purpose.

## Built-in skills

The harness ships its skills in `packages/workspace/skills/`, and
every UI gets them:

| Skill          | What it does                                                                        |
| -------------- | ----------------------------------------------------------------------------------- |
| `create-skill` | Creates or improves a skill: what it's for, where it goes, its description and body |

`create-skill` follows the [Agent Skills spec](https://agentskills.io/specification) and the
authoring guides from [Anthropic](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices)
and [OpenAI](https://developers.openai.com/codex/skills). To change a built-in skill for one
project, add a skill with the same name to its `.agents/skills/`; for every project, to
`~/.sheavly/skills/`.

A skill that doesn't load (no frontmatter, an invalid field, or a name that isn't its folder's) is reported with its path and the reason, and the others still load. `findSkills` returns these as `problems`, and a skill hidden by another with its name as `hidden`; the terminal chat prints both when it starts. A folder without a `SKILL.md` is not a skill, so it can hold shared files.

Skills are instructions, not code, so workspace trust doesn't gate them, just as it doesn't gate AGENTS.md. Review a cloned repo's skills as you would its AGENTS.md.

## The hook and read_skill

`createSkillsHook({ root, home? })` (`@sheavly/workspace/skills/`) is a `beforeTurn` hook. Before every model call it lists each skill's name and description as system instructions. Skills are re-read every turn, so a skill that is added or edited applies on the next call. Bodies are never in the list. The list is capped at 8,000 characters, with a note saying how many skills were left out. Leave out `home` to read only the project's skills.

The model reads a skill with `read_skill` (`@sheavly/coding/read-skill/`): its `SKILL.md` by default, or `file`, a path relative to the skill's folder. User skills live outside the workspace, so `read_skill` reads outside it, but only inside the skill's own folder (symlinks are followed, as in a workspace), and never a `.env` file. Its line and character limits are the same as `read_file`'s.

## Running a skill by name

The user runs a skill by mentioning it, `/<name>`, anywhere in a message: at the
start (`/git submit`), in the middle (`please /review this PR`) or at the end (`fix the tests,
then /git`). A message can mention several. A mention stands on its own, so paths and URLs such
as `/usr/bin` or `https://x.dev/git` are never one.

A UI that supports this passes every prompt to `skillRequest({ root, home, prompt })`. The
terminal chat and the workbook do; the demo sends its one prompt as it is, so its model only
sees the skills list. `prompt` is the protocol's `SendPromptRequest`, one of:

- `{ text }`, as a script or a plain input types it: each `/<name>` mention of a known skill runs
  it, and an unknown one stays text.
- `{ parts }`, as a UI with a `/` menu builds it: `[{ type: 'text', text }, { type: 'skill', name }]`.
  Exactly the skills picked run, and a `/name` inside a text part stays text. A picked skill no
  one has throws `UnknownSkillError`: the UI's list is stale.

`skillRequest` returns:

- `text`: the message to send. With skills, that is each skill's instructions, then what the
  user typed (a skill part reads `/<name>`). Otherwise it is the text unchanged.
- `parts`: with skills, what the user typed, for the history (`Message.parts`), so a UI shows the
  skills as chips. From `text`, known mentions become skill parts.
- `skills`: the skills it ran, in order. It runs `disable-model-invocation` skills too, because
  the user asked for them.
- `unknown`: mentions in `text` no skill has. A UI may report one the message starts with as an
  unknown command, as the terminal chat does, so a typo isn't sent.

## Skills in a UI

The harness says which skills exist and what in the text is a mention, so every UI shows the
same thing and what is highlighted is what runs. The UI only draws it:

| In the UI                               | From the harness                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/` opens a menu of skills              | `findSkills({ root, home })`: each skill's name, description, `manualOnly` and scope. Read it when the menu opens, not per keystroke  |
| Typing `/rev` narrows it                | `completeSkillMention({ text, cursor, skills })` (`skills.utils`): what was typed, the range a pick replaces, and the skills that fit |
| `/review` is highlighted, `/nope` isn't | `findSkillMentions(text)` (`skills.utils`): each mention's name and range; highlight those whose name is in the list                  |
| Enter runs it                           | `skillRequest({ root, home, prompt })`, which runs the same mentions                                                                  |

`completeSkillMention` offers every skill for a bare `/`, names starting with what was typed
first, then names containing it. It offers user-only skills too, since the user runs them. A UI
with commands of its own (the terminal's `/model`) lists them next to the skills. Tab in the
terminal chat completes skill names this way.

The terminal adds the hook and `read_skill` to every run (the chat, the demo and the workbook)
and to its sub-agents, so a sub-agent sees the same skills as its parent.
