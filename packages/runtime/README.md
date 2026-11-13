# @sheavly/runtime

The stateful services a run uses, with nothing about files or code: the session tree and its
inboxes, background tasks, and approvals. `createHarness` (`@sheavly/host`) makes one of each per
run; tools and the loop share them.

Tasks default to `backgroundKind: 'task'`: finite work. `backgroundKind: 'service'` is never
awaited; its eventual completion still produces a delivery. `TaskRegistry.hasPendingTasks(sessionId?)`
includes non-service running tasks, their held grouped results, and ready, undelivered completion
notices: what keeps a sub-agent's loop open. A main session holds only for
`hasAwaitedTasks(sessionId?)`, running members of an `await_tasks` group. `hasWakingDeliveries`
says a ready notice reports finite work, so an idle conversation starts a run for it; a
service's notice does not. A finished finite member keeps a sub-agent's run alive until its group
is delivered, even if only service members remain; a group containing only running services does
not.

`TaskRegistry.group({ ids, reason, sessionId? })` returns immediately and holds its members for
one delivery when the last settles, including cancelled members. Unknown, duplicate, already
grouped, unowned, service and already delivered IDs (`task_delivered`) throw `TaskError` without
changing anything; empty groups are rejected. A task cancelled on request was never notified, so
it can still join a group.
Already settled members join the group instead of producing separate undelivered notices.
After validation succeeds, the explicit `reason` is stored on every member's `TaskInfo` as well as
on the delivery. It remains available through `get`, `list`, `byCallId` and `takeDeliveries`, even
after delivery; these return independent snapshots. Rejected groups assign no reasons, and
ungrouped tasks do not infer a reason from their command or description.
Membership persists after delivery until each task is released. Ordinary requested cancellations
remain silent. Task observers still receive every start/end immediately, even for held groups.
Registering an already-settled group also wakes `nextSettled` waiters, so a parked run can consume
its new delivery without waiting for an unrelated task to finish.

`takeDeliveries(sessionId?)` consumes ready `TaskDelivery` values (`{ tasks: TaskInfo[], reason?:
string }`) once, in readiness order, with group members in requested ID order.
`hasDeliveries(sessionId?)` checks readiness without consuming. Supplying a session filters all
these queries and group validation by ownership, while allowing generic tasks with no session ID;
a child cannot consume its parent's results. `cancelSession(sessionId)` cancels exact ownership
only (descendant signals cascade separately); `cancelAll()` remains registry-wide for main-run
shutdown. `takeUnreported()` and `hasUnreported` are compatibility views over ready deliveries.

`TaskRegistry.runningTasks(sessionId?)` returns fresh metadata-only `RunningTask[]` snapshots
(from the protocol's notice types) in task start order: `{ id, title, reason, startedAt, group? }`.
It includes every compatible running task, including services, excludes settled tasks, and never
consumes deliveries. `title` is the description; `reason` is the stored group reason or falls back
to the description. `group` is the first requested member ID, stable even after that member settles,
not an ID array. Returned arrays and entries share no mutable state with the registry. This query
does not limit count or text; consumers bound snapshots when constructing a notice.

Scoped snapshots include exact session ownership and generic tasks, not parent or child ownership.
If a group has any member incompatible with the caller, its compatible running tasks remain visible,
but their shared group ID and reason are hidden: the reason falls back to each description. This
avoids exposing another owner's task ID or combined context. An unscoped caller sees all metadata.

A group's `sessionId` validates its members, not ownership of the group itself. A generic-only
group remains shared with every session. Delivery to a scoped consumer requires every member
to be compatible with that session; an unscoped group spanning different owned sessions needs
an unscoped consumer, not either session's loop.

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
| `errors/`    | `SessionError`, `TaskError`, the approval errors, and `errorMessage` / `isMissingPath`                                                                                        |
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

A task started with a `capture` (an `OutputWriter` from the conversation's output store) also keeps
its complete output: the registry appends every chunk, shows the log's reference and completeness
as `TaskInfo.outputLog` while it runs, and closes the log before the task settles, so a failed or
cancelled task's output stays readable. `formatTask` and the task-finished notice print the
`output_ref` and, when the preview is shorter than the log, tell the model to use `read_output` or
`search_output` instead of rerunning the command.

A task's `output` is that bounded preview: progress, never a result to rely on. A task whose result
is a document, such as a sub-agent's report, returns it as `report` from `run`. The registry keeps
it whole, outside `OutputBuffer` and outside `TaskInfo`, so no limit applies and no task event
carries it; `TaskRegistry.report(id)` reads it, and `formatTask` shows it in place of the output.

Neither registry forgets on its own: a UI frees memory on request. `SessionRegistry.release(id)`
removes an ended session and the sub-agents under it (it throws `session_running` if any is still
open), with their inboxes, last tokens and message ids; entries already in the combined stream
stay. `TaskRegistry.release(id)` removes a task that finished and was reported, or was cancelled on
request, with its output and report, and returns false for one still running or not yet reported;
`releaseFinished()` does it for every such task. Held or ready-but-undelivered group members
cannot be released, including cancelled members; after delivery, each member can be released.

- [Sessions](docs/sessions.md): the session tree, messages and steering, streaming to a UI.
- [Approvals](docs/approvals.md): how a tool asks the user, and how a UI answers.
