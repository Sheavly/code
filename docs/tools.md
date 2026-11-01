# Tools

## Writing a tool

A tool is a folder in `src/tools/<name>/` with a `<name>.tool.ts` that returns
`defineTool({ name, description, inputSchema, execute })` (from `@sheavly/core/tool/tool.service`).

- `inputSchema` is a `z.object`. Don't add a `description` field: the harness adds one for the
  model's plain-language note ("reading index.ts") and strips it before `execute`.
- `execute({ input, signal, context })` returns text for the model, or `{ content, change }`
  when it changed a file (below). Throw an `Error` with a clear message on failure:
  `runTool` turns it into an error result, so one failing tool never stops the others.
- `context` has the `callId`, the model's `description`, and the calling `session` (its id,
  parent, main session and depth; see [sessions.md](sessions.md)).
- Pass `signal` to every async operation, so an interrupt stops the tool.
- Wire the tool into the host (`src/demo.ts`) and export it from `src/index.ts`.

## Built-in tools

| Tool                                            | Where                                     | What it does                                                             |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `read_file`, `write_file`, `edit_file`          | `read-file/`, `write-file/`, `edit-file/` | File access in the workspace (below)                                     |
| `run_command`                                   | `run-command/`                            | Allow-listed commands; `background: true` for tasks                      |
| `task_status`, `cancel_task`                    | `tasks/`                                  | Check on and stop background tasks                                       |
| `start_agent`, `report_status`, `message_agent` | `sub-agent/`                              | Sub-agents, their status, and steering them ([sessions.md](sessions.md)) |

## File tools

All three go through the `Workspace` sandbox (`src/runtime/workspace/`): paths are relative to
the root, and anything that ends up outside it is refused, including `../`, absolute paths and
symlinks that point out. `.env` files are refused by name, before and after symlinks.

| Tool         | What it does                                                                               |
| ------------ | ------------------------------------------------------------------------------------------ |
| `read_file`  | Returns a UTF-8 file, or lines `startLine`–`endLine`; at most 1,000 lines per call (below) |
| `write_file` | Creates or overwrites a file with `content`; creates missing folders                       |
| `edit_file`  | Replaces `oldText` with `newText` in an existing file                                      |

`edit_file` needs `oldText` to match exactly and occur once. If it occurs more often, the edit is
refused unless `replaceAll` is set, so an ambiguous edit can't change the wrong place. Errors
tell the model how to fix the call (read the file first, add surrounding lines, or use
`write_file` for a new file). `newText` is inserted literally (`$&` stays `$&`).

`read_file` returns at most 1,000 lines per call (and at most 100,000 characters, for files with
very long lines). Pass `startLine` and `endLine` (1-based, inclusive) to read a range. Its limits
**fail open**: a request it can't fully serve is never an error, so no information is lost. It
returns what fits, plus a note at the end saying which lines were shown, why, and how to read on:

```
[Showing lines 1–1000 of 1500. read_file returns at most 1000 lines per call. To read on, call read_file with startLine 1001.]
```

Next to the text, `read_file` returns a `FileRead` (`{ path, startLine, endLine, totalLines,
whole }`), which the loop puts on the `tool_result` event as `read`, like `change` for writes.
The model never sees it; it's for a UI. The demo shows `read src/a.ts` when `whole` is true, and
`read src/a.ts lines 40–45 (of 1500)` otherwise.

A range past the end, a reversed range or a line number that isn't one is adjusted the same way,
with a note. Only the guards fail closed: `.env` files and paths outside the workspace are always
refused.

Shared pieces live in `src/tools/files/`: `resolveWritable` (the write-path check),
`readIfExists`, `writeText`, and the `.env` guard all three tools use.

## File changes: the harness emits, the UI renders

A tool that changes a file returns `{ content, change }`, where `change` is a `FileChange`
(`@sheavly/core/tool/tool.types`):

```ts
type FileChange = {
  path: string; // relative to the workspace root
  before: string | null; // null: the tool created the file
  after: string;
};
```

- The model sees only `content`, a one-line summary (`Edited src/a.ts (4 → 5 lines)`).
  `change` is never put in history, so it costs no tokens.
- The loop puts `change` on the `tool_result` event. A UI renders the diff from `before` and
  `after`; how (unified, side by side, word-level) is the UI's choice. The demo just prints the
  summary.
- An `aroundToolCall` hook sees `change` on the result of `next()`, and can drop or replace it.

Full content, not a computed diff, keeps the harness simple and lets every UI diff its own way.
For very large files this may need a size limit or a diff format later.
