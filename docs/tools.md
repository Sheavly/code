# Tools

## Writing a tool

A tool is a folder with a `<name>.tool.ts` that returns
`defineTool({ name, description, inputSchema, execute })` (from `@sheavly/core/tool/tool.utils`): in
`@sheavly/tools` (`packages/tools/src/<name>/`) for a generic tool, in `@sheavly/coding`
(`packages/coding/src/<name>/`) for one that touches files or runs commands.

- `inputSchema` is a `z.object`. Don't add a `description` field: the harness adds one for the
  model's plain-language note ("reading index.ts") and strips it before `execute`.
- `execute({ input, signal, context })` returns text for the model, or `{ content, artifacts }`
  to also give a UI data the model never sees, like a file's diff (see "Artifacts" below). Throw
  an `Error` with a clear message on failure: `runTool` turns it into an error result, so one
  failing tool never stops the others.
- `context` has the `callId`, the model's `description`, and the calling `session` (its id,
  parent, main session and depth; see [sessions.md](sessions.md)).
- Pass `signal` to every async operation, so an interrupt stops the tool.
- Wire the tool into the host (`src/demo.ts`) and export it from `src/index.ts`.

## Built-in tools

| Tool                                            | Where                                     | What it does                                                             |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `read_file`, `write_file`, `edit_file`          | `read-file/`, `write-file/`, `edit-file/` | File access in the workspace (below)                                     |
| `run_command`                                   | `run-command/`                            | Allow-listed commands; `background: true` for tasks ([below](#commands)) |
| `task_status`, `cancel_task`                    | `tasks/`                                  | Check on and stop background tasks                                       |
| `start_agent`, `report_status`, `message_agent` | `sub-agent/`                              | Sub-agents, their status, and steering them ([sessions.md](sessions.md)) |

## File tools

All three go through `Workspace` path confinement (`@sheavly/workspace/workspace/`), which is not an OS
sandbox ([trust model](overview.md#trust-model)): paths are relative to
the root, and anything that ends up outside it is refused, including `../`, absolute paths and
symlinks that point out. `.env` files are refused by name, before and after symlinks. Writes
inside `.git` (any path part equal to `.git`, in any case, so `.git/config`, `.git/hooks/x`,
`sub/.git/config` and a `.git` file) are refused the same way: git config and hooks there can make
the next `git status` run any program, outside every check `run_command` makes.

| Tool         | What it does                                                                               |
| ------------ | ------------------------------------------------------------------------------------------ |
| `read_file`  | Returns a UTF-8 file, or lines `startLine`–`endLine`; at most 1,000 lines per call (below) |
| `write_file` | Creates or overwrites a file with `content`; creates missing folders                       |
| `edit_file`  | Replaces `oldText` with `newText` in an existing file                                      |

`edit_file` needs `oldText` to match exactly and occur once. If it occurs more often, the edit is
refused unless `replaceAll` is set, so an ambiguous edit can't change the wrong place. Errors
tell the model how to fix the call (read the file first, add surrounding lines, or use
`write_file` for a new file). `newText` is inserted literally (`$&` stays `$&`).

Tool calls in a turn run in parallel, so `write_file` and `edit_file` share a per-file lock
(a `FileLocks` from `@sheavly/workspace/file-locks/`, one per harness), keyed by the file's real path (a symlink and its
target share one). Each holds it from reading the file to writing it back, so changes to one file
apply one after the other, each starting from what the previous one wrote; changes to different
files still run at the same time. A call aborted while it waits gives up its place.

`read_file` returns at most 1,000 lines per call (and at most 100,000 characters, for files with
very long lines). Pass `startLine` and `endLine` (1-based, inclusive) to read a range. Its limits
**fail open**: a request it can't fully serve is never an error, so no information is lost. It
returns what fits, plus a note at the end saying which lines were shown, why, and how to read on:

```
[Showing lines 1–1000 of 1500. read_file returns at most 1000 lines per call. To read on, call read_file with startLine 1001.]
```

Next to the text, `read_file` returns a `FileRead` artifact (`{ kind: 'file_read', path,
startLine, endLine, totalLines, whole }`, in `@sheavly/coding/read-file/read-file.types`), which the
loop puts on the `tool_result` event's `artifacts`, like the `FileChange` of writes. The model
never sees it; it's for a UI. The demo shows `read src/a.ts` when `whole` is true, and
`read src/a.ts lines 40–45 (of 1500)` otherwise.

A range past the end, a reversed range or a line number that isn't one is adjusted the same way,
with a note. Only the guards fail closed: `.env` files, writes inside `.git` and paths outside the
workspace are always refused.

Shared pieces live in `@sheavly/coding/files/`: `resolveWritable` (the write-path check, with the `.git`
guard), `readIfExists`, `writeText`, and the `.env` guard all three tools use.

## Commands

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
[trust model](overview.md#trust-model).

### Approvals: the harness asks, the UI renders

The harness renders no prompt. A command that needs approval waits in an `ApprovalRegistry`
(`@sheavly/runtime/approvals/`; `createHarness` makes one, as `harness.approvals`, unless one is passed in), which emits typed
`ApprovalUpdate` events to its subscribers. The UI subscribes, shows each request its own way,
and answers with `respond`:

```ts
harness.approvals.subscribe((update) => {
  if (update.type === 'approval_requested') ui.show(update.request);
});
harness.approvals.respond({ id: request.id, response: { decision: 'approve' } });
```

| Update               | Carries                                                                             |
| -------------------- | ----------------------------------------------------------------------------------- |
| `approval_requested` | `request`: `id`, `callId`, `sessionId`, `tool`, `command`, `concerns`, `options`    |
| `approval_resolved`  | `id` and the `response`, once it's answered                                         |
| `approval_cancelled` | `id`: the waiting call was interrupted (its `signal` aborted) before an answer came |

`concerns` is `{ argument, reason }[]`; `options` is `['approve', 'skip', 'skip_with_message']`.
The tool waits (the run's other tools and the model stream carry on) until `respond` is called
with one of:

- `{ decision: 'approve' }`: the command runs as asked.
- `{ decision: 'skip' }`: the command doesn't run; the model gets an error result naming the
  arguments.
- `{ decision: 'skip_with_message', message }`: the command doesn't run, and the message is added
  to that result ("Instead, the user says: …"), so it steers the model's next step.

`respond` validates the answer with zod and throws for a malformed one or an id that isn't
waiting (an `ApprovalRequestError`); `pending()` lists open requests for a UI that connects late.
With no subscriber (a headless run, the demo, the workbook) those commands are refused right away
instead of waiting. A refused or skipped command fails the tool call with a `CommandRefusedError`
(`reason: 'needs_approval' | 'skipped'`), whose message is what the model reads.

A subscriber that throws doesn't stop the others: every listener still hears the update, then an
`ApprovalListenerError` reaches whoever caused it. On `approval_requested` the request fails
closed (the command doesn't run), unless a listener already answered it while hearing the
update, which stands; on `approval_resolved` the call still gets its answer and `respond`
throws; on `approval_cancelled` the call fails with that error.

These updates come from the registry, not the loop's event stream: a tool result waiting in that
ordered stream would hold back the request it waits for.

## Artifacts: the tool returns them, the harness passes them on, the UI renders them

A tool can return data for a UI next to its text: `{ content, artifacts }`, where each artifact
is a `ToolArtifact` (`@sheavly/protocol/event/event.types`), an object tagged with a `kind`:

```ts
type ToolArtifact = { kind: string; [field: string]: unknown };
```

- The tool owns its kinds: it names them and defines their shape, next to itself. A parser could
  return `{ kind: 'table', columns, rows }` without any change to core or the loop.
- The model sees only `content`. Artifacts are never put in history, so they cost no tokens.
- The loop puts them, as the tool returned them, on the `tool_result` event (`artifacts`; left
  out when there are none). It never looks inside.
- An `aroundToolCall` hook sees them on the result of `next()`, and can drop, replace or add some.
- A UI renders the kinds it knows and skips the rest. The built-in kinds come with a type guard
  for narrowing: `isFileChange` (`@sheavly/coding/files/files.utils`) and `isFileRead`
  (`@sheavly/coding/read-file/read-file.utils`), both exported from `src/index.ts`.

### File changes

`write_file` and `edit_file` return a `FileChange` artifact (`@sheavly/coding/files/files.types`):

```ts
type FileChange = {
  kind: 'file_change';
  path: string; // relative to the workspace root
  before: string | null; // null: the tool created the file
  after: string;
};
```

- The model sees a one-line summary (`Edited src/a.ts (4 → 5 lines)`).
- A UI renders the diff from `before` and `after`; how (unified, side by side, word-level) is
  the UI's choice. The demo just prints the summary.

Full content, not a computed diff, keeps the harness simple and lets every UI diff its own way.
For very large files this may need a size limit or a diff format later.
