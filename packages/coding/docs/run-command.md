# run_command

How `run_command` checks a command before it runs it. When a command needs approval it asks through the approval registry ([@sheavly/runtime](../../runtime/docs/approvals.md)).

## The checks

`run_command` checks a command in three steps before running it, unless `skipAllowList` is set:

1. **Allow list:** its first words must match an entry in `allow-list.constants.ts`, and it may
   not contain shell syntax. Anything else is refused; the user isn't asked.
2. **Arguments** (`arguments.helper.ts`): operands, `--opt=value` values, values attached to
   short options (`-O../x`) and every word after `--` are checked with the same path rules as
   the file tools. An argument needs the user's approval if it reaches outside the workspace
   (`../..`, an absolute path, a symlink out) or can name a `.env` file (`.env`, `HEAD:.env`,
   `:(top).env`, `.\env`, a symlink to one, or any glob: git's `*`, `?` and `[...]` cross `/`, so
   `c*` or `config?.env` reach `config/.env`). Arguments that aren't existing paths (`HEAD~1`, a
   test name) pass. One the path check can't check at all (unreadable, a symlink loop: a
   `PathCheckError`) is never treated as "not a path": it needs approval, as "could not be
   checked (ELOOP)".
3. **Git output** (`git-output.utils.ts`): a git command that can print or write file contents
   needs approval whatever its arguments, since a patch shows a committed `.env` without naming
   it. This is an allowlist, not a list of patch flags (those always miss one: `--patch-with-stat`,
   `status -v`, or `-G` matches that leak a secret one guess at a time): `git status`, `git log`
   and `git diff` run without asking only when every flag is one known to show no contents
   (`git status -sb`, `git log --oneline -n 5`, `git diff --stat`), and a diff also needs a
   summary flag. Any other flag, subcommand or plain `git diff` asks.

Every command then runs with git config that keeps a repo from making git run programs: a write
to `.git/config` is refused (above), but a hostile repo can arrive with one. `GIT_CONFIG_NOSYSTEM=1`
and `GIT_CONFIG_COUNT` env overrides (`SAFE_GIT_CONFIG` in `run-command.constants.ts`) win over
every config file: `core.fsmonitor` off, `core.hooksPath=/dev/null`, `safe.bareRepository=explicit`
(an implicit bare repo brings its own config), no signature checks and no `gpg.*` program.
`attr.tree=HEAD` reads attributes from the last commit (an empty tree before the first), so an
edited `.gitattributes` can't switch on a filter driver (`filter.<name>.clean`) the config
defines. Since they're in the
env, they also reach git that a test runner starts. `git diff`, `log` and `show` also get
`--no-ext-diff --no-textconv`, so diff drivers (`diff.external`, textconv) never run.

Left open: a filter that is both in the repo's config and named in a committed `.gitattributes`
still runs (there is no switch for every filter driver, and a write to `.git/config` that would
add one is refused), and git older than 2.42 ignores `attr.tree`.

Test runners on the allow list (`npm test`, `npx vitest run`) run workspace code, which can read
anything the process can; argument checks can't stop that. Isolating the process itself is
[#4](https://github.com/Sheavly/code/issues/4); until then, see the
[trust model](../../../docs/overview.md#trust-model).
