# File tools

`read_file`, `write_file` and `edit_file`, and the artifacts they return.

## Confinement and the three tools

All three go through `Workspace` path confinement (`@sheavly/workspace/workspace/`), which is not an OS
sandbox ([trust model](../../../docs/overview.md#trust-model)): paths are relative to
the root, and anything that ends up outside it is refused, including `../`, absolute paths and
symlinks that point out. `.env` files are refused by name, before and after symlinks. Writes
inside `.git` (any path part equal to `.git`, in any case, so `.git/config`, `.git/hooks/x`,
`sub/.git/config` and a `.git` file) are refused the same way: git config and hooks there can make
the next `git status` run any program, outside every check `run_command` makes.

When the app sets `scratchRoot` (the backend uses `<tmpdir>/sheavly`), the tools may also use that
shared folder, by absolute path: an agent keeps notes and hand-offs in `<scratch>/<agent-id>/`,
and sub-agents use their root agent's folder. The whole scratch root is open to every agent, in
every conversation, on purpose; the rest of the filesystem is not, symlinks out of it are refused,
and the `.env` rule still applies. A scratch path is reported absolute, so the `.git` name check
applies only to paths inside the workspace.
`run_command` does not check paths and is unchanged.

| Tool         | What it does                                                                               |
| ------------ | ------------------------------------------------------------------------------------------ |
| `read_file`  | Returns a UTF-8 file, or lines `startLine`–`endLine`; at most 1,000 lines per call (below) |
| `write_file` | Creates a new file with `content`, and its missing folders; refuses one that exists        |
| `edit_file`  | Replaces `oldText` with `newText` in an existing file the agent has read                   |

`write_file` only creates. A path that already holds a file is refused with a message pointing to
`edit_file`, checked under the file's lock so two agents creating one path can't both win. To
replace a whole existing file, `edit_file` with the whole old text as `oldText`.

`edit_file` needs `oldText` to match exactly and occur once. If it occurs more often, the edit is
refused unless `replaceAll` is set, so an ambiguous edit can't change the wrong place. Errors
tell the model how to fix the call (read the file first, add surrounding lines, or use
`write_file` for a new file). `newText` is inserted literally (`$&` stays `$&`).

**Read before edit.** `edit_file` refuses a file the calling agent has not read (`read_file`) or
created (`write_file`), so an edit is made from what the file holds, not from memory. Reads are
kept per agent (a `FileReads` from `@sheavly/workspace/file-reads/`, one per harness), by real
path: the main agent and each sub-agent must read for themselves, and a symlink and its target are
one file. It does not stop a file changing after it was read; the exact-text match does that, so an
edit to text that has since changed fails. A reopened conversation starts with nothing read.

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

## Searching with `grep`

`grep` searches file contents with ripgrep, using the binary `@vscode/ripgrep` ships so nothing
has to be installed. It runs through the harness's `ProcessRunner`, in the workspace root.

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
