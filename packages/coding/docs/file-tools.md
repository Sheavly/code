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
