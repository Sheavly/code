# File tools

`read_file`, `write_file`, `edit_file` and `delete_file`, and the artifacts they return.

Model-facing descriptions and input guidance live in each tool's adjacent `*.prompt.ts`, including
those of `grep` and `glob`. Pure prompt builders format read-continuation and search-narrowing
instructions from prepared values. Selection, limits, validation, filesystem effects and artifact
construction remain in the tool and its helpers; factual statuses and errors remain code-owned.

## Confinement and the four tools

All four go through `Workspace` path confinement (`@sheavly/workspace/workspace/`), which is not an OS
sandbox ([trust model](../../../docs/overview.md#trust-model)): paths are relative to
the root, and anything that ends up outside it is refused, including `../`, absolute paths and
symlinks that point out. `.env` files are refused by name, before and after symlinks. Writes and
deletes inside `.git` (any path part equal to `.git`, in any case, so `.git/config`, `.git/hooks/x`,
`sub/.git/config` and a `.git` file) are refused the same way: git config and hooks there can make
the next `git status` run any program, outside every check `run_command` makes.

When the app sets `scratchRoot` (the backend uses `<tmpdir>/sheavly`), the tools may also use that
shared folder, by absolute path: an agent keeps notes and hand-offs in `<scratch>/<agent-id>/`,
and sub-agents use their root agent's folder. The whole scratch root is open to every agent, in
every conversation, on purpose; the rest of the filesystem is not, symlinks out of it are refused,
and the `.env` rule still applies. A scratch path is reported absolute, so the `.git` name check
applies only to paths inside the workspace.
`run_command` does not check paths and is unchanged.

| Tool          | What it does                                                                               |
| ------------- | ------------------------------------------------------------------------------------------ |
| `read_file`   | Returns a UTF-8 file, or lines `startLine`–`endLine`; at most 1,000 lines per call (below) |
| `write_file`  | Creates a new file with `content`, and its missing folders; refuses one that exists        |
| `edit_file`   | Replaces `oldText` with `newText` in an existing file the agent has read                   |
| `delete_file` | Deletes one file; refuses a folder, a symlink, a `.env` file and anything outside          |

`write_file` only creates. A path that already holds a file is refused with a message pointing to
`edit_file`, checked under the file's lock so two agents creating one path can't both win. To
replace a whole existing file, `edit_file` with the whole old text as `oldText`.

`edit_file` needs `oldText` to match exactly and occur once. If it occurs more often, the edit is
refused unless `replaceAll` is set, so an ambiguous edit can't change the wrong place. Errors
tell the model how to fix the call (read the file first, add surrounding lines, or use
`write_file` for a new file). `newText` is inserted literally (`$&` stays `$&`).

`delete_file` removes one file, and reports the content it held in the `FileChange` below, so a UI
can show the deletion. It does not ask for approval: like the other file tools, only `run_command`
is gated by the user's command permissions. It refuses a folder, since removing one takes files the
agent never named (`run_command` can ask for it), and a symlink whichever way it points: the tool
deletes the file the agent named, never the target that a link names for it. It reads and removes
under the file's lock, and a file already gone is an error rather than a success, since the delete
may have been meant for another path. Like `edit_file`, it is gated on a read: the agent must have
read the file (`read_file`) or created it, so it removes what it has seen, not a path it guessed. A
file larger than
`MAX_DELETE_BYTES` (100,000 bytes) is refused with a pointer to `run_command`, so a deletion never
reads a huge file into its result. What each agent was shown of the file is forgotten, so an edit of
a file later created at that path is not made from memory.

**Read before edit or delete.** `edit_file` and `delete_file` refuse a file the calling agent has
not read (`read_file`) or created (`write_file`), so a change is made from what the file holds, not
from memory. Each read keeps a hash of the whole file as it was then. `edit_file` and
`delete_file` already hold the file's current text under its lock, so they compare its hash: a file
that changed since (by a command, the user or another agent) is refused with "changed since you read
it" and needs a new read, and a file that did not change keeps its read, so a command that never
touched it costs no re-read. An agent's own edit updates its hash, so it can edit that place again
unread; another agent's view of the file goes stale. A released session's reads go with it
(`createCodingHarness` clears them). Reads are kept per agent (a `FileReads` from
`@sheavly/workspace/file-reads/`, one per harness), by real path: the main agent and each sub-agent
must read for themselves, and a symlink and its target are one file.

**Reads survive a reopen.** The backend keeps the main agent's reads (the pieces it was shown and
each file's hash, at most the 200 files read last) in the conversation's `shell.json` when a prompt
ends, and restores them when the conversation is reopened. They are not trusted to still hold: the
hash is compared with the file as it is then, so a file that changed while the conversation was
closed asks for a new read, and one that did not change costs none. Sub-agents are not kept: a
running one comes back interrupted. Stored reads that are not valid are reported and ignored, and
the run starts with nothing read; a failed save is reported and the run goes on.

Tool calls in a turn run in parallel, so `read_file`, `write_file`, `edit_file` and `delete_file` share a
per-file lock (a `FileLocks` from `@sheavly/workspace/file-locks/`, one per harness), keyed by the
file's real path (a symlink and its
target share one). Each holds it from reading the file to writing it back, so changes to one file
apply one after the other, each starting from what the previous one wrote; changes to different
files still run at the same time. A call aborted while it waits gives up its place.

`read_file` returns at most 1,000 lines per call (and at most 100,000 characters, for files with
very long lines). Pass `startLine` and `endLine` (1-based, inclusive) to read a range. Its limits
**fail open**: a request it can't fully serve is never an error, so no information is lost. It
returns what fits, plus a note at the end saying which lines were shown, why, and how to read on.
It reads the file as a stream, under the file's lock, in one pass that hashes the text, counts the
lines and keeps only the lines to show (a line longer than the character cap is kept only as far as
the cap), so a file of any size is read in bounded memory and never refused for its size:

```
[Showing lines 1–1000 of 1500. read_file returns at most 1000 lines per call. To read on, call read_file with startLine 1001.]
```

Next to the text, `read_file` returns a `FileRead` artifact (`{ kind: 'file_read', path,
startLine, endLine, totalLines, whole }`, in `@sheavly/coding/read-file/read-file.types`), which the
loop puts on the `tool_result` event's `artifacts`, like the `FileChange` of writes. The model
never sees it; it's for a UI. The demo shows `read src/a.ts` when `whole` is true, and
`read src/a.ts lines 40–45 (of 1500)` otherwise.

A range past the end, a reversed range or a line number that isn't one is adjusted the same way,
with a note. Only the guards fail closed: `.env` files, writes and deletes inside `.git` and paths
outside the workspace are always refused.

## Policy table

One policy, decided once in `files/files.helper.ts` (`resolveReadable`, `resolveWritable`,
`resolveDeletable`; a search root goes through `resolveSearchRoot`). A tool file never calls the
workspace's `resolveRead`, `resolveWrite` or `resolveDelete` itself: `harness/guard-file-tool-resolve`
fails it. `file-tool-policy.test.ts` asserts every cell below for every tool.

| Case                       | read_file / grep / glob | write_file       | edit_file              | delete_file                     |
| -------------------------- | ----------------------- | ---------------- | ---------------------- | ------------------------------- |
| `.env`, by name or symlink | refused                 | refused          | refused                | refused                         |
| inside `.git` (any root)   | refused                 | refused          | refused                | refused                         |
| outside the workspace      | refused                 | refused          | refused                | refused                         |
| symlink out of the root    | refused                 | refused          | refused                | refused                         |
| symlink inside the root    | follows to the target   | refused (exists) | writes through         | refused                         |
| needs a prior read         | no                      | no               | yes                    | yes                             |
| takes the file's lock      | read_file: yes          | yes              | yes                    | yes                             |
| size over `MAX_FILE_BYTES` | streamed, never refused | content refused  | file or result refused | over `MAX_DELETE_BYTES` refused |
| aborted call               | fails, nothing changes  | same             | same                   | same                            |

Every file tool runs its body through `runFileTool` (`files/file-tool.helper.ts`): an already
aborted call fails before it touches the disk, a path with nothing at it is a `not_found` error
naming the path the model gave, a path the workspace refused or could not check is `forbidden`,
and anything else (including an abort mid-call) passes through. No raw `ENOENT` reaches the model.

Decisions: reads are locked (a read never sees a half-written file); a delete needs a read, like an
edit; a write or edit follows a symlink inside the root to its target (outside the root it is
refused), while a delete never follows or removes a link. `grep` and `glob` take no lock and need no
read, and apply the same `.env`/`.git`/confinement checks to the path they are given and to what
they walk. `read_file` streams, so it has no size limit of its own; `edit_file` (which must hold the
file and its result in memory) refuses a file over `MAX_FILE_BYTES` (5,000,000 bytes) from its size
on disk before it is loaded, and `write_file` refuses content over it. A read stays valid until the
file's hash changes, not until the next command.

Shared pieces live in `@sheavly/coding/files/`: `files.helper.ts` holds `resolveReadable`,
`resolveWritable` and `resolveDeletable` (the read-, write- and delete-path checks, with the `.env`
and `.git` guards);
`file-effects.helper.ts` holds the filesystem effects (`readIfExists`, `readForChange`, `writeText`,
`createParentFolder`, `removeFile`, `fileSize`); and `file-change.helper.ts` builds the result a
tool returns.

## The working root

An agent working on a branch in a separate git worktree can call `set_working_root` once with that
folder. From then on a relative path in `read_file`, `write_file`, `edit_file`, `delete_file`,
`grep`, `glob`, and the `cwd` of `run_command` starts there, and paths in results are shown
relative to it. It is a default base, not a sandbox: absolute paths and `../` still go through
`Workspace`, which decides what is reachable, and the `.env` and `.git` rules still hold.

- **Kept per conversation.** The root is in the conversation's `shell.json`, next to its history,
  so the main session and its sub-agents share it, a restart or a resume keeps it, and deleting the
  conversation deletes it. It never moves the user's terminal or the process's own cwd.
- **What it must be.** `set_working_root` takes a folder the workspace can reach (its root,
  scratch or a verified sibling worktree) that is a git work tree. `.git`, a folder inside it, a
  bare repo and a `.env` folder are refused, and the branch is read from git, never from the agent.
  `set` resolves a relative path against the workspace root, not against the current root.
- **A root that is gone** (its worktree was removed) is never read as "unset": relative paths in
  the file tools and `run_command` fail with a message telling the agent to set another, so a
  write meant for the worktree cannot land in the main checkout. Each turn's note says so too.
- **Where it is read.** A tool reads the root once per call with `currentRoot`
  (`files/working-root.helper.ts`), which checks the folder is still reachable but runs no git. The
  per-turn note (`working-root/working-root-hook.helper.ts`) and the UI's details also ask git for
  the branch.
- **Enforced by** `harness/guard-working-root`: a call to `resolveRead`, `resolveWrite` or
  `resolveDelete` in this package must take a path that went through `anchorToRoot`, a process is
  never started with `cwd: workspace.root`, and no helper is handed a literal `root: undefined`.
  What the rule cannot see (that the `root` is the current one, and the cwd of a process built some
  other way) rests on `working-root.tool.test.ts`.

## Searching with `grep`

`grep` searches file contents with ripgrep, using the binary `@vscode/ripgrep` ships so nothing
has to be installed. It runs through the harness's `ProcessRunner`, in the workspace root (or the
working root, when one is set).

- **Input:** `pattern` (a regex), optional `path` (a file or folder, default the whole workspace),
  `glob`, `mode` and `caseInsensitive`.
- **Modes:** `content` (default) returns `path:line:text`, `files` only the paths that match, and
  `count` the number of matching lines per file.
- **Confinement:** `path` goes through `Workspace.resolveRead`, so escapes and symlinks that point
  out are refused, and a `.env` path or a path inside `.git` is refused by name and after
  symlinks. ripgrep never applies its excludes to a root path it is given, which is why the tool
  checks that path itself. For what it walks, the tool passes case-insensitive excludes for
  `.env`, `.env.*` and `.git` (a folder, or the file a submodule or worktree has) after the
  agent's `glob`, so no pattern or glob can bring their content back, whatever the case of the
  name. The agent's own `glob` is case-insensitive too, because ripgrep has one setting for both. ripgrep's own config is ignored (`--no-config`) and
  the pattern goes behind `--regexp`, so it can't be read as a flag.
- **Failures:** exit 0 and 1 are results. A search that printed results but could not read some
  files (exit 2) returns them with a note and `skipped` on the artifact, so a partial search is
  never presented as complete. A killed process or an error with no output is an error result,
  never "no matches".
- **Limits:** at most 200 results, lines longer than 300 characters are shortened, ripgrep is
  stopped after 2,000,000 characters of output and after 30 seconds. Like `read_file`, a cut is
  never silent: the text says how many results were shown and to narrow the search.
- **Artifact:** a `GrepResult` (`kind: 'grep_matches'`, `@sheavly/coding/grep/grep.types`) with
  the results for the mode asked and `truncated`, for a UI. The model never sees it.

## Finding files with `glob`

`glob` lists the files whose path matches a pattern, newest first. It runs `rg --files` with the
agent's pattern as a case-insensitive glob, then stats each file (`lstat`, so a symlink's own time)
to sort by modification time, ties by path.

- **Input:** `pattern` (a glob) and optional `path` (a folder, default the whole workspace).
- **Confinement:** the same as `grep`: `path` is checked by name and after symlinks, and the
  `.env`, `.env.*` and `.git` excludes come after the agent's pattern.
- **Limits:** at most 200 files are returned. Only the first 5,000 matches by path are stat-ed, so
  past that the newest is the newest of those; either cut sets `truncated` and the text says so.
- **Artifact:** a `GlobResult` (`kind: 'glob_files'`, `@sheavly/coding/glob/glob.types`) with the
  files, `truncated` and `skipped`, for a UI.

## File changes

`write_file`, `edit_file` and `delete_file` return a `FileChange` artifact
(`@sheavly/coding/files/files.types`):

```ts
type FileChange = {
  kind: 'file_change';
  path: string; // relative to the workspace root
  before: string | null; // null: the tool created the file
  after: string | null; // null: the tool deleted the file
};
```

- The model sees a one-line summary (`Edited src/a.ts (4 → 5 lines)`, `Deleted src/a.ts (4 → 0
lines)`).
- A UI renders the diff from `before` and `after`: `before: null` is a new file and `after: null`
  a deleted one. How (unified, side by side, word-level) is the UI's choice. The demo prints the
  summary.

Full content, not a computed diff, keeps the harness simple and lets every UI diff its own way.
For very large files this may need a size limit or a diff format later.
