# Harness impact

The harness (the skills in `.agents/skills/`, the `harness/*` lint rules, the workspace graph, the
hooks, `knip.json`, the docs nudge) only checks what someone wired in. When a change introduces
something the next agent must follow, the same PR adds its enforcement: never a gap, never a
doc-only note ("Enforce what you add" in the project skill). Run this at [triage.md](triage.md)
(the judgement triggers) and before [submit.md](submit.md) (the mechanical ones, against
`git diff origin/main...HEAD`), then write the PR body's `## Harness impact` section.

## Triggers

**Mechanical**, visible in the diff:

- a new workspace (`packages/<name>/`, `apps/<name>/`);
- a new `exports` entry in a package's `package.json` (a file kind made public: is every file of it meant to be?);
- a new file kind, or a file named `<name>.<kind>.ts` with a kind `file-kinds.js` doesn't know;
- a new skill in `.agents/skills/`, or a skill's files moved;
- a new contract other code must import rather than copy (a wire type, an artifact kind, a hook
  point);
- a new root config or tooling script (`scripts/`, `.cursor/hooks/`);
- a new runtime dependency;
- a new env var read by a host;
- an `ignore` added to `knip.json` or `.jscpd.json`: there are no baselines, so a finding is
  fixed, not ignored, unless the ignore says why.

**Judgement**, asked once per issue at triage:

- a "use X, never Y" convention that only works if everyone follows it;
- a security or trust concept (the sandbox, approvals, workspace confinement);
- a non-obvious workaround (it took more than one attempt);
- the same review correction twice.

**Already enforced, stay quiet:** a new type in an existing `*.types.ts`
(`harness/single-definition`), a new workspace's rules and scripts (`workspace-coverage.test.js`),
a new skill's metadata (`skills.utils.test.mjs`), a new scope's area label
(`sync-area-labels.mjs`), file names and kinds (`harness/file-kind`), a new workspace's domain, configs and
dependencies (`harness/layout`, `npm run layout`), imports across workspaces
(`harness/imports`), an app's front-end rules (`baseConfig`, from its folder).

## What to add

| The trigger is about…                      | Add                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| a new workspace                            | create it with the scaffold (the skill's "A new package"): it sets its `sheavly.domain`, configs and dependencies; nothing central to edit    |
| an `exports` entry                         | a whole file kind, added with `npm run export` (`harness/layout` holds its shape); the PR body says why every file of that kind is public     |
| a file kind                                | its policy in `file-kinds.js` and RuleTester cases                                                                                            |
| a skill                                    | its `harness.json` (`governs` globs, or `manual` with a reason)                                                                               |
| a contract to import, not copy             | its schema or type in the owning package's `*.types.ts`, so `harness/single-definition` covers it; a `harness/*` rule if the shape needs more |
| a "use X, never Y" convention              | a `harness/*` rule in `packages/eslint-config/src/rules/`, derived from the code, whose message says what to do instead; RuleTester tests     |
| a hook-level behaviour (shell, git, edits) | a hook in `.cursor/hooks/` with tests in `__tests__/`, listed in `.cursor/hooks.json` and the README's hooks table                            |
| something with nothing to enforce          | `none: <reason>` in the PR body                                                                                                               |

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
