# Harness impact

The development harness is the ESLint rules, file-kind policies and configuration, plus git
guards and GitHub workflow checks around the codebase. The git skill coordinates their use.
This is not the coding-harness product's agent runtime, loop, tools or providers.

When work introduces a constraint the next contributor must follow, the same PR adds its
enforcement and regression tests: never a gap or a doc-only note. Assess judgement triggers at
[triage.md](triage.md), then run the closing assessment before [submit.md](submit.md). Not every
issue needs a new guardrail, but every PR explains its coverage.

## Triggers

**Mechanical**, visible in the diff:

- a new workspace (`packages/<name>/`, `apps/<name>/`);
- a new `exports` entry in a package's `package.json` (a file kind made public: is every file of it meant to be?);
- a new file kind, or a file named `<name>.<kind>.ts` with a kind `file-kinds.js` doesn't know;
- a new skill in `.agents/skills/`, or a skill's files moved;
- a new contract other code must import rather than copy (a wire type, an artifact kind, a hook
  point);
- a new shared helper or API with a required usage path, call order or placement convention;
- a new root config or tooling script (`scripts/`, `.cursor/hooks/`);
- a new runtime dependency;
- a new env var read by a host;
- an `ignore` added to `knip.json` or `.jscpd.json`: there are no baselines, so a finding is
  fixed, not ignored, unless the ignore says why.

**Judgement**, asked once per issue at triage:

- a "use X, never Y" convention that only works if everyone follows it;
- a structural or API usage constraint, including a required helper instead of a direct call;
- a git workflow constraint that the existing guards or CI do not check;
- a security or trust concept (the sandbox, approvals, workspace confinement);
- a non-obvious workaround (it took more than one attempt);
- the same review correction twice.

**Existing coverage, verify the constraint:** a new type in an existing `*.types.ts`
(`harness/single-definition`), a new workspace's rules and scripts (`workspace-coverage.test.js`),
a new skill's metadata (`skills.utils.test.mjs`), a new scope's area label
(`sync-area-labels.mjs`), file names and kinds (`harness/file-kind`), a new workspace's domain, configs and
dependencies (`harness/layout`, `npm run layout`), imports across workspaces
(`harness/imports`), an app's front-end rules (`baseConfig`, from its folder).

These checks only cover the constraints they actually reject. Type uniqueness does not enforce
calling the right helper; an allowed import does not enforce correct API usage. Read the rule or
guard and its tests before claiming coverage. Ordinary product behaviour belongs in product tests,
not a new lint rule unless it establishes an enforceable coding convention.

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
| a git/GitHub workflow constraint           | the existing git guard or CI check that owns it, with acceptance and rejection tests                                                          |
| something with nothing to enforce          | `none: <reason>` in the PR body                                                                                                               |

## Closing assessment

Before submission, assess the finished diff (`git diff origin/main...HEAD`, or against the layer
below in a stack) and decisions made during the issue, not just the original plan:

1. List the coding conventions, API usage constraints, structure and git workflow constraints
   introduced or clarified. Include workarounds and repeated review corrections; check both
   mechanical and judgement triggers.
2. For each constraint, inspect existing enforcement and regression tests. Say what invalid code
   or command they reject and why that matches the constraint. Do not treat a populated PR section,
   type uniqueness or layout as proof of behavioural or usage coverage.
3. Add or extend missing ESLint rules, policies, configuration or git workflow guards/checks,
   with focused tests accepting the supported path and rejecting the bypass. Derive coverage from
   file roles or workspace metadata rather than lists of today's names. Guidance alone is not
   enforcement. If a constraint cannot be checked mechanically, explain the limitation rather
   than inventing a brittle rule or claiming it is enforced.
4. Put new enforcement in a distinct closing commit of its owning scope
   (`feat(eslint-config): …`, or `chore: …` for git guards and root checks). Keep it in the same PR;
   place it earlier only when a later commit depends on it or a closing placement would break
   an intermediate commit. Tests belong with the enforcement. Explain a placement exception.
5. Run the affected checks and report the assessment before pushing. Review any new enforcement
   added after the branch review. Write the PR section below, including specific reasons when
   no new guardrail is needed.

This pass does not authorize a commit, push or issue change the user did not request; follow the
git skill's operation and approval rules.

## The PR body section

Every PR body has `## Harness impact`, before `## Test plan`. Use one bullet per applicable
constraint, explaining coverage and naming the ESLint rule or executable check path and its
regression-test path in backticks. Identify the commit when enforcement changed. For existing
coverage, explain why the named check already rejects the relevant violation.

A constraint needing no new guardrail gets a `- none: <constraint and reason>` bullet. When no
constraints apply, use a single `none: <reason>` line. A generic "existing checks cover it" is not
a substantive assessment.

The `Git format` check rejects a missing or empty section, unexplained `none`, and coverage bullets
without enforcement and regression-test references. It checks reporting format only: it does not
validate referenced files, inspect the diff semantically or prove the enforcement is sufficient.
Reviewers must verify coverage against the actual constraint.

```markdown
## Harness impact

- Cross-workspace imports follow boundaries: existing `harness/imports` rejects forbidden imports;
  regression cases in `packages/eslint-config/src/__tests__/imports.test.js`.
- PR guardrail reporting: `scripts/check-git-format.mjs` rejects coverage without evidence;
  tests in `scripts/__tests__/check-git-format.test.mjs` (commit 2).
```

```markdown
## Harness impact

none: a bug fix inside `turn.helper.ts`; the closing assessment found no new coding convention,
API usage constraint, structural requirement or git workflow constraint.
```
