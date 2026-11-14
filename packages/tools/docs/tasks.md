# The task tools

`createTaskTools(tasks)` (`@sheavly/tools/tasks/`) returns three tools on a run's `TaskRegistry`
(`@sheavly/runtime/tasks/`), for background work: commands started with
`run_command`'s `background: true` ([@sheavly/coding](../../coding/docs/run-command.md)) and
sub-agents ([sub-agents.md](sub-agents.md)), which run as tasks too.

| Tool          | Input             | What it does                                                                                                     |
| ------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `task_status` | `{ id? }`         | Immediate inspection: one task's status and recent output (or complete sub-agent report), or a list of all tasks |
| `await_tasks` | `{ ids, reason }` | Immediately registers a completion group; holds notices until every member finishes                              |
| `cancel_task` | `{ id }`          | Stops a running task and waits until its process has exited                                                      |

- The agent doesn't need `task_status` to wait: the loop reports finished tasks once at turn
  boundaries. Finite tasks, including sub-agents, keep the run alive automatically by default.
  Persistent commands explicitly use `backgroundKind: 'service'` and need not exit before the
  agent finishes ([@sheavly/loop](../../loop/docs/run.md)).
- Status calls are immediate snapshots for requested updates or diagnosis, not waits. The
  description and every running snapshot tell the agent not to poll: finish independent work,
  then end a turn without tool calls to let the loop wait for required results.
- `await_tasks` requires at least one id and a trimmed, nonempty `reason`. The reason explains
  why the results belong together and what decision or next step depends on them, so the agent's
  future self can use them after a summary. Guidance rejects lazy reasons such as "waiting for
  results"; validation checks presence and nonempty text, not a brittle wording rule.
- Group registration returns immediately. `TaskRegistry.group` validates unknown ids, duplicates,
  existing group ownership and tasks whose notice was already delivered atomically: an invalid
  call claims no members, and the model sees the refusal as an error result. The tool forwards
  the calling session id when available, and registry errors become tool error results. The
  registry holds grouped completion notices until all members settle, then the loop delivers
  the results together with the reason.
- An unknown status or cancellation id is a `ToolCallError` (`reason: 'not_found'`). Cancelling an
  already finished task returns its status without an error. Ungrouped cancellation suppresses
  the completion notice because the caller already knows; cancellation of a grouped member is
  handled by the registry so it does not bypass the group's delivery semantics.
- A UI that wants them includes them; a run without background work can leave them out.
