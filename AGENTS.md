# Sheavly harness

An agent harness built as a backend: a small generic core (protocol, core, providers, runtime,
tools, loop, host), coding as a preset on top (workspace, coding), and every front end an app
(`apps/*`). npm workspaces + Turbo, ESM TypeScript, Node 24. Why it exists and where it is going:
`docs/vision.md`; how it fits together: `docs/overview.md`.

## Where to look

- Conventions, layers, file kinds and the quality gate: the `working-in-sheavly-harness` skill
  (`.agents/skills/working-in-sheavly-harness/SKILL.md`).
- Which workspace code belongs in: the `sheavly-packages` skill; then that workspace's README.
- Branches, commits, PRs and issues: the `git` skill.

## Code style

Lint enforces the mechanics (`packages/eslint-config/src/readability.js`: blank lines around
blocks and before `return`, `max-depth` 3, `max-nested-callbacks` 3,
`sonarjs/cognitive-complexity` 15, `curly`, `no-nested-ternary`, `no-else-return`). The post-edit
hook reports what is left, with a hint on how to fix it (`packages/eslint-config/src/rule-hints.js`).
Lint can't tell whether code reads well, so beyond that, write for a human reviewer:

- A function is a few steps. When one does several jobs (setting up, streaming, cleaning up),
  extract each into a function named for what it does; don't just reshuffle conditions to get
  under a limit.
- A function that changes state outside itself says so in its name (`keepHistory`, not `record`).
- Name a value when the name adds meaning the expression lacks; otherwise return or pass it
  directly.
- Branch with early `return`, not chained ternaries.
- Code that looks wrong on purpose (a hand-driven iterator instead of `for await`, an order that
  matters) gets a comment saying why, so the next reader doesn't "simplify" it into a bug.
- Comments: one or two sentences of constraint or trade-off, never what the code does. History
  ("this used to…") goes in the commit message.
