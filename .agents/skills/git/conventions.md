# Conventions: formats and examples

The rules live in code (`.cursor/hooks/git-workflow.utils.mjs`), used by the git guard and the
`Git format` CI check; this file is their documentation. Issues are GitHub issues (`#123`).

## Branches

`<issue>-<kebab-name>`, based on `main` (or, in a stack, on the layer below): the issue number, a hyphen, then a kebab-case name for
the task. This is GitHub's own form, so `gh issue develop` and the issue's "Create a branch" button
produce it, and GitHub lists the branch under the issue's Development panel.

```bash
gh issue develop 123 --name 123-road-segment-export --base main --checkout
```

| Good                      | Bad                            | Why bad                          |
| ------------------------- | ------------------------------ | -------------------------------- |
| `123-road-segment-export` | `road-segment-export`          | no issue number                  |
| `123-export`              | `#123-export`, `123/export`    | just the number, then a hyphen   |
| `123-provider-switch`     | `123-ProviderSwitch`           | the name must be kebab-case      |
| `123-provider-switch`     | `feature/123-provider-switch`  | no prefix: the number starts it  |
|                           | `PROJ-123/road-segment-export` | other trackers' keys aren't used |

One branch per PR; the part after the number names the task, not a scope. Usually that is one
branch per issue, but a stack ([stacks.md](stacks.md)) may have several layers for the same issue
(`123-switch-contract`, `123-switch-loop`), or one per sub-issue. The guard denies an agent creating
a branch for an issue the chat hasn't named. `main` and branches from before this workflow keep
their names.

## Scopes

A commit's scope is where the change lives: a package (`core`, `eslint-config`) or a top-level
folder of `src/` (`loop`, `providers`, `runtime`, `tools`, `host`, `workbook`). Leave the scope out
for repo-wide or root tooling changes (`.cursor/`, `scripts/`, `.github/`, root configs). The list
is read from disk, so a new package or folder is a valid scope without any edit.

## Commits in a PR

A PR's commits, in review order. Each holds one scope, in the order the work was built, so every
commit only depends on the ones below it:

```text
feat(core): add a provider switch contract
feat(providers): register the astra adapter in the switch
feat(loop): switch providers between turns
feat(host): add a /model command to the terminal UI
docs: describe provider switching
```

Bad: `feat: add switching` (one commit for every scope), `feat(loop): add switching and its
contract` (two scopes), `fix(core): fix the switch contract` as the fifth commit of a draft (fold
it into the core commit; [fix.md](fix.md)).

## Commit messages

`type(scope): subject`, an optional body explaining why, then a `Refs: #123` footer naming the
branch's issue.

- Types: `feat fix refactor perf test docs build ci chore revert`. A `!` after the type or scope
  marks a breaking change (`feat(core)!: …`).
- The subject is imperative and lowercase, with no full stop; the header is at most 72 characters.
- `Refs: #123`, not `Closes #123`: commits only reference the issue. The PR body is what closes it,
  once, when the PR merges.

Good:

```text
feat(tools): add the edit_file tool

Refs: #123
```

```text
fix(loop): keep tool results in order when a turn is interrupted

The abort handler appended placeholders before the results that had already arrived.

Refs: #130
```

```text
chore: add the git guard hook

Refs: #131
```

The scope is left out in the last one because the change is root tooling.

Bad:

- `Fixed stuff`: no type and no issue, and it says nothing.
- `feat: Add export.`: the subject is capitalised and ends with a full stop, and there is no
  `Refs:` footer.
- `feat(api): add export`: `api` isn't a package or `src/` folder.
- `#123 add export`: the issue belongs in the footer (commits) and the body (PRs).
- `Closes #123` in a commit: it would close the issue as soon as that commit reached `main`.

## PR titles

`type(scope): subject`, the same header format as a commit. With a squash merge the title becomes
the one commit on `main`, so its type and scope describe the whole PR (the main scope it changes;
leave the scope out when it spans several equally). GitHub appends ` (#45)`, the PR number, to the
squashed commit itself, so the title carries no number.

Good: `feat(providers): switch providers between turns`

Bad: `Provider switching`, `#123`, `feat: add switching (#123)`, `[#123] feat: add switching`.

## PR bodies

The standard is in [submit.md](submit.md) ("PR body standard"); `.github/pull_request_template.md`
pre-fills its sections. The last line is `Closes #123`, alone on its line: that links the PR to the
issue and closes it on merge. CI fails a PR without it, or one whose `Closes` doesn't name the
branch's issue. A sub-issue's PR closes the sub-issue, not the parent.

In a stack ([stacks.md](stacks.md)), a layer that doesn't finish its issue ends with `Part of #123`
instead: it links the issue without closing it, so the issue stays open until the top layer (which
says `Closes #123`) merges. Its `## Why` names the layer below (`Stacked on #45`).

## PR bases

`main`, or for a stacked PR the branch of the layer below (an issue branch). CI fails a PR based on
anything else.

A compact one:

```markdown
## Why

#123 asks for switching the model provider mid-session without losing history.

## Commits

Review bottom up, one commit at a time.

1. `a1b2c3d` feat(core): add a provider switch contract: the `ProviderSwitch` type.
2. `d4e5f6a` feat(providers): register the astra adapter in the switch: config validation.
3. `b7c8d9e` feat(loop): switch providers between turns: where the switch is read.

## What changes

**Switch** (`packages/providers/src/switch/`)

- `ProviderSwitch.use(kind)` swaps the adapter; the next model call uses it.
- Encrypted reasoning from the old provider is dropped, since only its source can read it.

## How to review

- Read carefully: `sample.helper.ts` in commit 3 (when the switch is read).
- Skim: the adapter registration in commit 2.

## Harness impact

none: provider switching changes product behaviour, not a coding or git workflow convention;
the closing assessment found no new codebase constraint requiring enforcement.

## Test plan

- [x] `npm run check` passes on the current head.
- [x] Bugbot and security reviews of the current head: 1 finding fixed in commit 3, none open.
- [ ] Switch from openai to astra in the demo with a real key.

Closes #123
```

Bad: a body that repeats the diff, says "various improvements", has no `## Commits` list or one
that doesn't match the commits, ticks a test that wasn't run, has no `## Harness impact` (or a
bare `none`), or has no `Closes #123`.
