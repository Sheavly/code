# Sheavly harness

An agent harness built as a backend: a small generic core (protocol, core, providers, runtime,
tools, loop, host), coding as an extension on top (workspace, coding), and every front end an app
(`apps/*`). npm workspaces + Turbo, ESM TypeScript, Node 24. Why it exists and where it is going:
`docs/vision.md`; how it fits together: `docs/overview.md`.

## Where to look

- Conventions, layers, file kinds, extending the harness, tests, the quality gate, debugging and
  the state machines of each system: the `sheavly` skill (`.agents/skills/sheavly/SKILL.md`), a
  router to one guide per topic. Keep issue #102 in mind: extend the harness, never modify its core.
- Which workspace code belongs in: the `sheavly-packages` skill; then that workspace's README.
- Branches, commits, PRs and issues: the `git` skill.

## Codebase guardrails

Development-harness impact means the ESLint rules, file-kind policies and configuration, plus
git guards and GitHub workflow checks that keep this repository clean. It does not mean changes
to the coding-harness product's agent runtime, loop, tools or providers.

Follow `.agents/skills/git/harness.md`: report applicable constraints and planned enforcement at
triage, then assess the finished diff and decisions before submission. Missing enforcement ships
with focused regression tests in the same PR, as a distinct closing commit when dependencies
allow. Existing type ownership or import boundaries only cover those constraints, not correct
API usage or other coding conventions. Reviewers flag missing guardrails and unsupported coverage
claims. Not every issue needs a guardrail change, but every PR explains its assessment.

## File length

Lint caps lines of code (blank and comment lines aside) per file kind, set in
`packages/eslint-config/src/file-kinds.js`: `tool`, `adapter`, `routes`, `errors` and `component` 150;
`types`, `constants`, `prompt`, `validator`, `service` and `fake` 300; `test` 500; a file with no kind 300.
`utils` and `helper` files have no cap: split one by responsibility when it does several jobs,
not to fit a number.

## Model prompts

Keep authored model instructions, tool/parameter guidance and prompt templates in adjacent
`*.prompt.ts` files. Prompt files hold related text/data and pure typed renderers, not I/O,
state, model calls or validation. Execution and schemas stay in their existing file kinds;
exported types and numeric configuration stay in types/constants files. User/runtime data,
human-facing messages, tests/fakes and stored Markdown prompts are not authored production prompts.
`harness/prompt-location` checks supported model-facing boundaries; review covers dynamic paths
that static analysis cannot follow. Keep prompts internal unless their whole kind is deliberately
made public. Review prompt/source changes with `npm run lint:prompt`; matching hashes record
explained review, not semantic correctness or model compliance.

## Code style

Lint enforces the mechanics (`packages/eslint-config/src/readability.js`: blank lines around
blocks and before `return`, `max-depth` 3, `max-nested-callbacks` 3,
`sonarjs/cognitive-complexity` 15, `curly`, `no-nested-ternary`, `no-else-return`). The post-edit
hook reports what is left, with a hint on how to fix it (`packages/eslint-config/src/rule-hints.js`).
Lint can't tell whether code reads well, so beyond that, write for a human reviewer:

- A function is a few steps. When one does several jobs (setting up, streaming, cleaning up),
  extract each into a function named for what it does; don't just reshuffle conditions to get
  under a limit.
- Extract a function when its name hides something the caller no longer needs to know. If
  reading the caller means opening the helper, the split went too far: keep it inline.
- Remove duplication of knowledge, not of shape. Two blocks that look alike but change for
  different reasons stay separate (shape them differently if jscpd flags them). A shared function
  that grows flags or special cases for one caller is the wrong abstraction: inline it back and
  extract only what is truly common.
- Parse once at the boundary into a precise type, and let code past it trust that type: no
  re-checks downstream, no optional fields for states that can't coexist (use a union).
- A function that changes state outside itself says so in its name (`keepHistory`, not `record`).
- Name a value when the name adds meaning the expression lacks; otherwise return or pass it
  directly.
- Branch with early `return`, not chained ternaries.
- Code that looks wrong on purpose (a hand-driven iterator instead of `for await`, an order that
  matters) gets a comment saying why, so the next reader doesn't "simplify" it into a bug.
- Comments: one or two sentences of constraint or trade-off, never what the code does. History
  ("this used to…") goes in the commit message.
- An exported function or type gets a doc comment for what its signature can't say: what it
  expects, what it throws, what order or state it relies on. Skip it when the signature says it
  all.
