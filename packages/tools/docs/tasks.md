# The task tools

`createTaskTools(tasks)` (`@sheavly/tools/tasks/`) returns two tools on a run's `TaskRegistry`
(`@sheavly/runtime/tasks/`), for background work: commands started with
`run_command`'s `background: true` ([@sheavly/coding](../../coding/docs/run-command.md)) and
sub-agents ([sub-agents.md](sub-agents.md)), which run as tasks too.

| Tool          | Input     | What it does                                                                             |
| ------------- | --------- | ---------------------------------------------------------------------------------------- |
| `task_status` | `{ id? }` | With an id: that task's status and its recent output. Without: every task, one line each |
| `cancel_task` | `{ id }`  | Stops a running task and waits until its process has exited                              |

- The agent doesn't need `task_status` to wait: the loop reports each finished task at the start
  of the next turn, once, in the order they finished, and a run with `waitForTasks` waits for them
  ([@sheavly/loop](../../loop/docs/run.md)).
- An unknown id is an error result (a `ToolCallError` with `reason: 'not_found'`), and so is
  cancelling a task that has already finished. A cancelled task isn't reported back as a
  completion.
- A UI that wants them includes them; a run without background work can leave them out.
