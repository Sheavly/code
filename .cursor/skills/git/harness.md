# Harness impact

The harness (the skills in `.cursor/skills/`, the `harness/*` lint rules, the ESLint layers, the
hooks, `knip.json`, the docs nudge) only checks what someone wired in. When a change introduces
something the next agent must follow, the same PR adds its enforcement: never a gap, never a
doc-only note ("Enforce what you add" in the project skill). Run this at [triage.md](triage.md)
(the judgement triggers) and before [submit.md](submit.md) (the mechanical ones, against
`git diff origin/main...HEAD`), then write the PR body's `## Harness impact` section.

## Triggers

**Mechanical**, visible in the diff:

- a new workspace (`packages/<name>/`);
- a new `exports` pattern shape in a `package.json` (anything but `./*` with `@sheavly/source`,
  `types` and `default`);
- a new top-level folder in `src/` (a new layer, scope or front end);
- a new file kind, or a file named `<name>.<kind>.ts` with a kind `file-kinds.js` doesn't know;
- a new skill in `.cursor/skills/`, or a skill's files moved;
- a new contract other code must import rather than copy (a wire type, an artifact kind, a hook
  point);
- a new root config or tooling script (`scripts/`, `.cursor/hooks/`);
- a new runtime dependency;
- a new env var read by a host;
- a baseline (knip, jscpd) changed by anything but pruning.

**Judgement**, asked once per issue at triage:

- a "use X, never Y" convention that only works if everyone follows it;
- a security or trust concept (the sandbox, approvals, workspace confinement);
- a non-obvious workaround (it took more than one attempt);
- the same review correction twice.

**Already enforced, stay quiet:** a new type in an existing `*.types.ts`
(`harness/single-definition`), a new workspace's rules and scripts (`workspace-coverage.test.js`),
a new skill's metadata (`skills.utils.test.mjs`), a new scope's area label
(`sync-area-labels.mjs`), file names and kinds (`harness/file-kind`).

## What to add

| The trigger is about…                      | Add                                                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a new workspace                            | its `eslint.config.js`, `tsconfig*.json` and scripts (the skill's "A new package"), a `knip.json` entry, its `layout.js` entry (`kind`, `domain`, `dependsOn`) |
| an `exports` pattern                       | the matching resolution in `harness/single-definition`'s workspace reader (`workspace-types.js`) and a test with the new shape                                 |
| a new `src/` folder                        | a layer in `layout.js`, `FRONT_END_FILES` if it is a UI, a `DOC_SOURCES` entry (`docs.utils.mjs`), the skill's layer table                                     |
| a file kind                                | its policy in `file-kinds.js` and RuleTester cases                                                                                                             |
| a skill                                    | its `harness.json` (`governs` globs, or `manual` with a reason)                                                                                                |
| a contract to import, not copy             | its schema or type in the owning package's `*.types.ts`, so `harness/single-definition` covers it; a `harness/*` rule if the shape needs more                  |
| a "use X, never Y" convention              | a `harness/*` rule in `packages/eslint-config/src/rules/`, derived from the code, whose message says what to do instead; RuleTester tests                      |
| a hook-level behaviour (shell, git, edits) | a hook in `.cursor/hooks/` with tests in `__tests__/`, listed in `.cursor/hooks.json` and the README's hooks table                                             |
| something with nothing to enforce          | `none: <reason>` in the PR body                                                                                                                                |

The check lives in the PR that introduces the thing, as a commit of the scope it lives in
(`feat(eslint-config): …`, or `chore: …` for hooks and root config), ordered after the code it
checks so every commit passes on its own.

## The PR body section

Every PR body has `## Harness impact`, before `## Test plan`: one bullet per trigger the diff
hits, naming what enforces it (the rule, test or hook, and its commit), or a single
`none: <reason>` line. The `Git format` check fails a body without the section, and one that is
empty.

```markdown
## Harness impact

- New workspace `packages/protocol`: covered by `workspace-coverage.test.js`; its layer is its
  own `eslint.config.js` (commit 1).
- Wire types: `harness/single-definition` fails a copy anywhere else (commit 15).
```

```markdown
## Harness impact

none: a bug fix inside `turn.helper.ts`; no new package, pattern or contract.
```
