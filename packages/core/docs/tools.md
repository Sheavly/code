# Writing a tool

The `Tool` contract (`@sheavly/core/tool/`) every tool is written against, and the artifacts a tool hands a UI. The built-in tools are documented where they live: the file tools and `run_command` in [@sheavly/coding](../../../extensions/coding/docs/), the task and sub-agent tools in [@sheavly/tools](../../tools/docs/).

## The contract

A tool is a folder with a `<name>.tool.ts` that returns
`defineTool({ name, description, inputSchema, execute })` (from `@sheavly/core/tool/tool.utils`): in
`@sheavly/tools` (`packages/tools/src/<name>/`) for a generic tool, in `@sheavly/coding`
(`extensions/coding/src/<name>/`) for one that touches files or runs commands.

- `inputSchema` is a `z.object`. Don't add a `description` field: the harness adds one for the
  model's plain-language note ("reading index.ts") and strips it before `execute`.
- `execute({ input, signal, context })` returns text for the model, or `{ content, artifacts }`
  to also give a UI data the model never sees, like a file's diff (see "Artifacts" below). Throw
  an `Error` with a clear message on failure: `runTool` turns it into an error result, so one
  failing tool never stops the others.
- `context` has the `callId`, the model's `description`, and the calling `session` (its id,
  parent, main session and depth; see [sessions](../../runtime/docs/sessions.md)).
- Pass `signal` to every async operation, so an interrupt stops the tool.
- A tool's `name` is what the model calls, so names are unique within a run, compared exactly
  (`Read` and `read` are two tools). A sub-agent's run adds `report_status` always, the task
  tools (`task_status`, `cancel_task`, `await_tasks`) when it can nest or `withTaskTools` is set,
  and `start_agent` and `message_agent` below the depth cap, to its parent's tools, so a parent
  tool with one of those names clashes there. The loop refuses a run with two tools of one name
  before its first model call, with a `DuplicateToolError` naming the tool (the run fails like a
  miswired hook: `run_failed`, then its one `done`). It checks the list the run starts with,
  then goes on with a frozen copy of it, so changing the caller's array later changes nothing.
  `runTool` itself runs the first match, so nothing else protects a caller that bypasses the
  loop.
- Include it from the backend that wants it: it adds its tools in `createBackendHarness`
  (`apps/backend/src/harness/harness.helper.ts`). No package adds a tool to a run.

## Artifacts

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
  (`@sheavly/coding/read-file/read-file.utils`).
