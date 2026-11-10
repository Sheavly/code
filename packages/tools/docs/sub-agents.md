# Sub-agents

The `start_agent`, `report_status` and `message_agent` tools. The session tree, inboxes and the event stream they build on are in [@sheavly/runtime](../../runtime/docs/sessions.md).

## Sub-agents

`createSubAgentTool(options)` (`@sheavly/tools/sub-agent/`) is the `start_agent` tool: it starts a
sub-agent on one task, `{ title, task }`.

- **A background task.** The sub-agent runs as a task in the parent's `TaskRegistry`, so the
  parent sees it with `task_status`, stops it with `cancel_task` (its session ends as
  `interrupted`), and is told its report when it finishes. Its task requires completion:
  the parent prompt stays alive and resumes automatically with the report even without
  `waitForTasks`. No user message or status polling is needed. Ordinary background commands can
  still outlive a prompt. Stopping the prompt stops waiting; any unfinished sub-agent result is
  then delivered on the next prompt, rather than restarting an interrupted run.
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

## Reports

What a sub-agent reports is its final answer, and the parent gets it whole, with no size limit.
`finalReply` takes the unbroken run of assistant messages that ends its last reply and joins them
in order with nothing between, because after an output-limit cut the continuation resumes
mid-text. What it said before its last tool call is work in progress and is left out, and so are
the `[status]` and `[message]` lines. A sub-agent that wrote no text gives a placeholder, so the
parent never gets a blank result.

`runChild` returns it as the task's `report`. The task registry keeps it outside the output
preview and outside `TaskInfo`, so the process-output limits never touch it, no event carries it
as part of the task, and `task_status <id>` shows it whole. The bounded preview still holds the
status lines and the end of the report for a UI card. Ordinary background commands keep their
bounded output. The `start_agent` and `task_status` descriptions say the report arrives whole.

## Status reporting

Every sub-agent gets `report_status({ status })`, and its instructions tell it to call it
before it starts and at each new step: "reading files, reading core package", then "editing
core package", then "updating ESLint rules". It's the sub-agent saying what it does, not the
harness watching its tool calls.

Each report updates the session in the registry, which tells its listeners
(`sessions.subscribe`) and adds a `[status] …` line to the task's output for the parent.
