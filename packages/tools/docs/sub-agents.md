# Sub-agents

The `start_agent`, `report_status` and `message_agent` tools. The session tree, inboxes and the event stream they build on are in [@sheavly/runtime](../../runtime/docs/sessions.md).

## Sub-agents

`createSubAgentTool(options)` (`@sheavly/tools/sub-agent/`) is the `start_agent` tool: it starts a
sub-agent on one task, `{ title, task }`.

- **A background task.** The sub-agent runs as a task in the parent's `TaskRegistry`, so the
  parent sees it with `task_status`, stops it with `cancel_task` (its session ends as
  `interrupted`), and is told its final reply when it finishes, like any background command.
- **Three levels, hard cap.** Main session → sub-agent → sub-agent (`MAX_SESSION_DEPTH = 3`).
  Below the cap a sub-agent gets `start_agent` too; at depth 3 it doesn't, and the registry
  refuses a fourth level regardless.
- **The parent chooses.** `options.tools` and `options.hooks` are what sub-agents get; the
  parent's own hooks are not inherited unless listed. Each sub-agent runs its own `sessionStart`.
  `options.baseInstructions` supplies shared guidance before the child role;
  `options.instructions` adds child extras after it. Outer whitespace is trimmed, blank sections
  are skipped, and sections are joined with one blank line. The same
  composition is passed to descendants. Neither option implicitly copies parent history or
  conversation overrides. The backend supplies its shared generic and coding text explicitly.
- **Its own context.** A sub-agent sees only its task, not the parent's conversation.
- The loop's `runSession` is passed in as `options.runAgent`: tools can't import the loop.
- `start_agent`, `report_status` and `message_agent` only work inside a session: called without
  one (`context.session` unset), they fail with a `ToolCallError` (`reason: 'unavailable'`).

## Status reporting

Every sub-agent gets `report_status({ status })`, and its instructions tell it to call it
before it starts and at each new step: "reading files, reading core package", then "editing
core package", then "updating ESLint rules". It's the sub-agent saying what it does, not the
harness watching its tool calls.

Each report updates the session in the registry, which tells its listeners
(`sessions.subscribe`) and adds a `[status] …` line to the task's output for the parent.
