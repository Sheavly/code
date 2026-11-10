# @sheavly/runtime

The stateful services a run uses, with nothing about files or code: the session tree and its
inboxes, background tasks, and approvals. `createHarness` (`@sheavly/host`) makes one of each per
run; tools and the loop share them.

Tasks started with `waitForCompletion: true` keep their calling run alive until the loop delivers
their result. `TaskRegistry.hasRequiredTasks` includes running and unreported required tasks;
ordinary background work remains non-blocking by default.

```ts
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
```

| Module       | What it holds                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions/`  | `SessionRegistry`: the session tree, inboxes, the SSE `stream`, and one ordered stream of every session (`publish`, `subscribeEntries`), kept in memory or written to a store |
| `tasks/`     | `TaskRegistry`: background tasks a run waits for, checks on and cancels                                                                                                       |
| `approvals/` | `ApprovalRegistry`: requests a UI answers with `respond`                                                                                                                      |
| `usage/`     | `UsageLedger`: cumulative usage across sessions, deduplicated by stream sequence                                                                                              |
| `output/`    | `OutputBuffer`: bounded first/last lines and shortened long lines for process and task previews                                                                               |
| `errors/`    | `SessionError`, the approval errors, and `errorMessage` / `isMissingPath`                                                                                                     |
| `testing/`   | Fakes for tests: sessions, approvals, `startTaskTool`                                                                                                                         |

## Docs

`SessionRegistry.setMessage` associates stream activity with the originating user message. New
children inherit that identity; existing children keep it as the parent moves on. Correlation is
restored from the stored stream. Error diagnostics retain selected, bounded fields and redact common
credential forms without serializing exception request objects.

`UsageLedger` restores a backend snapshot or consumes `usage` entries. Older snapshots cannot
overwrite newer live totals. Missing counts and unpriced calls remain explicit, never zero-cost.
`OutputBuffer` keeps at most 30 initial lines and 70 final lines within its character budget,
shortening each line to 1,000 characters with both ends visible. Omission markers label lost lines.

A task's output is that bounded preview: progress, never a result to rely on. A task whose result
is a document, such as a sub-agent's report, returns it as `report` from `run`. The registry keeps
it whole, outside `OutputBuffer` and outside `TaskInfo`, so no limit applies and no task event
carries it; `TaskRegistry.report(id)` reads it, and `formatTask` shows it in place of the output.

Neither registry forgets on its own: a UI frees memory on request. `SessionRegistry.release(id)`
removes an ended session and the sub-agents under it (it throws `session_running` if any is still
open), with their inboxes, last tokens and message ids; entries already in the combined stream
stay. `TaskRegistry.release(id)` removes a task that finished and was reported, or was cancelled on
request, with its output and report, and returns false for one still running or not yet reported;
`releaseFinished()` does it for every such task.

- [Sessions](docs/sessions.md): the session tree, messages and steering, streaming to a UI.
- [Approvals](docs/approvals.md): how a tool asks the user, and how a UI answers.
