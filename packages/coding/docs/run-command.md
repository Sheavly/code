# run_command

How `run_command` decides whether to run a command, and what it does when it does. When a command needs the user's say it asks through the approval registry ([@sheavly/runtime](../../runtime/docs/approvals.md)).

## What a command is

A line is split into words and run **without a shell** (`allow-list.utils.ts`). It may chain
commands with `|`, `&&`, `||` and `;`, which `ProcessRunner.runScript`
([@sheavly/workspace](../../workspace/README.md)) runs as a shell would: a pipe feeds one
command's output to the next while both run, `&&` and `||` look at the exit code, and the timeout
covers the whole line. Quotes group words, and single quotes are literal.

What a shell would do and this can't do faithfully is refused, with the reason, in every mode:
redirects (`> <`), `$variables` and `$(…)`, backticks, parentheses, a lone `&`, backslash
escapes, newlines, and `$`, backtick or `\` inside double quotes. A `cd` or `exit` builtin does
not exist either, since there is no shell for it to change.

## Who decides

The user's **permissions** for the workspace decide, read fresh on every command so a change
applies to every conversation running there from its next command. They come from the app
(`CommandPermissions`: `read()` and `allow(entry)`); this package never knows where they are kept.

| Mode         | What `run_command` does                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `ask`        | Runs a built-in or allowed command; asks about every other, and about any risky argument.             |
| `always_ask` | Asks about every command, whatever the allow list says.                                               |
| `allow_all`  | Runs everything, asking about nothing, risky arguments included. Redirects and the like stay refused. |

**Built-in commands** (`allow-list.constants.ts`) only read: `ls`, `pwd`, `git status`, `git log`,
`git diff`, `head`, `tail` and `wc`. The user's own allow list comes on top. No test runner is
built in: it runs the repo's own scripts, which the agent can edit.

One question covers the whole line, naming each command that is not allowed and each risky
argument, and skipping it skips the whole line. The user can answer:

- **approve**: run it this once.
- **always allow**: run it and keep an entry for each command not allowed yet (`allow-entry.utils.ts`):
  retain the first two words, or three for `npm run`, and append `*` only if more arguments follow.
  Thus `git log --oneline` becomes `git log *`, and `npm run test -- --watch` becomes
  `npm run test *`. Three kinds of command differ, because a wildcard must never allow more than
  the user can tell they agreed to:
  - A program that can run other programs or change files (`find`, `xargs`, `npx`, `env`, `sh`,
    `bash`, `zsh`, `sed`, `awk`, `perl`, `python*`, `node`, `ruby`, `make`, `rsync`, `tar`,
    `curl`, `wget`, `ssh`, `scp`, `sudo`, and `npm exec`; `EXACT_ONLY_PROGRAMS`) keeps only the
    exact command: `find src -type f` does not become `find src *`, which would allow
    `find src -exec rm {} +`. They match by name wherever the program lives, so
    `/usr/bin/find` is no way around it.
  - A read-only searcher (`grep`, `egrep`, `fgrep`; `SEARCHERS`) keeps `grep *` even when a flag
    comes second, since its second word is a flag or a pattern and never a subcommand: one
    approved search covers the next. Only a bare `grep`: `./grep` is a file the agent could have
    written. `rg`, `ag` and `ack` are not here, because they can run a program (`rg --pre`).
  - Anything else with a flag in second place (`git -c x log`) keeps only the exact command, since
    then it could mean anything. A `touch /path/file` stays exact because nothing follows it.
    Not offered when nothing could be kept: no entry can spell the command, the line is only risky
    arguments, or the mode is `always_ask`. The entry is kept before the line runs; if it can't be,
    the line does not run.
- **skip**, or **skip with a message**, which the model reads as the user's direction.

When "always allow" is offered, the approval request's `keeps` lists the exact entries that
would be saved, with duplicates removed. A UI displays these rather than deriving its own
permission from the command text. The same entries are saved if the user chooses that option.

A run with no one listening (no UI connected) refuses what it would have asked about.

A `grep` also gets `--exclude` flags for `.env` files added after its own arguments
(`safeGrepArgs`), in every mode including `allow_all`. Without them a recursive `grep -r KEY .`
reads every `.env` under the folder and prints it, which the file tools refuse by name and
argument checks cannot see (the folder is `.`, not a `.env`). They are added last because the last
matching `--include` decides, so a command's own `--include=*` cannot bring them back; and such an
`--include` glob is asked about anyway, as any glob that could name a `.env` file.

## The checks on arguments

Whatever the mode (but `allow_all`), these need the user's approval:

1. **Arguments** (`arguments.helper.ts`): operands, `--opt=value` values, values attached to
   short options (`-O../x`) and every word after `--` are checked with the same path rules as
   the file tools. An argument needs the user's approval if it reaches outside the workspace
   (`../..`, an absolute path, a symlink out) or can name a `.env` file (`.env`, `HEAD:.env`,
   `:(top).env`, `.\env`, a symlink to one, or any glob: git's `*`, `?` and `[...]` cross `/`, so
   `c*` or `config?.env` reach `config/.env`). Arguments that aren't existing paths (`HEAD~1`, a
   test name) pass. One the path check can't check at all (unreadable, a symlink loop: a
   `PathCheckError`) is never treated as "not a path": it needs approval, as "could not be
   checked (ELOOP)".
2. **Git output** (`git-output.utils.ts`): a git command that can print or write file contents
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

A command the user allows that runs workspace code (`npm test`, `npx vitest run`, a script) can
read anything the process can; argument checks can't stop that. Isolating the process itself is
[#4](https://github.com/Sheavly/code/issues/4); until then, see the
[trust model](../../../docs/overview.md#trust-model).
