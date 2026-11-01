# Tools

## Writing a tool

A tool is a folder in `src/tools/<name>/` with a `<name>.tool.ts` that returns
`defineTool({ name, description, inputSchema, execute })` (from `@sheavly/core/tool/tool.service`).

- `inputSchema` is a `z.object`. Don't add a `description` field: the harness adds one for the
  model's plain-language note ("reading index.ts") and strips it before `execute`.
- `execute({ input, signal, context })` returns text for the model, or `{ content, change }`
  when it changed a file (below). Throw an `Error` with a clear message on failure:
  `runTool` turns it into an error result, so one failing tool never stops the others.
- Pass `signal` to every async operation, so an interrupt stops the tool.
- Wire the tool into the host (`src/demo.ts`) and export it from `src/index.ts`.

## File tools

All three go through the `Workspace` sandbox (`src/runtime/workspace/`): paths are relative to
the root, and anything that ends up outside it is refused, including `../`, absolute paths and
symlinks that point out. `.env` files are refused by name, before and after symlinks.

| Tool         | What it does                                                         |
| ------------ | -------------------------------------------------------------------- |
| `read_file`  | Returns a UTF-8 file (cut at 100,000 characters, with a note)        |
| `write_file` | Creates or overwrites a file with `content`; creates missing folders |
| `edit_file`  | Replaces `oldText` with `newText` in an existing file                |

`edit_file` needs `oldText` to match exactly and occur once. If it occurs more often, the edit is
refused unless `replaceAll` is set, so an ambiguous edit can't change the wrong place. Errors
tell the model how to fix the call (read the file first, add surrounding lines, or use
`write_file` for a new file). `newText` is inserted literally (`$&` stays `$&`).

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
