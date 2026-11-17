---
description: group delayed finite checks with future-self context and no status polling
workspace: basic
maxTurns: 10
check:
  {
    'areas':
      [
        'packages/tools/src/tasks',
        'packages/runtime/src/tasks',
        'packages/loop/src/stream-agent',
        'packages/core/src/notice',
        'packages/protocol/src/notice',
        'extensions/coding/src/run-command',
      ],
    'expect':
      {
        'tools': ['run_command', 'await_tasks'],
        'toolResults':
          { 'await_tasks': ['Compare both release checks before recommending deployment.'] },
        'events': ['task_running', 'task_completed', 'harness_notice'],
        'reply':
          [
            'GROUP_ALPHA_PASSED',
            'GROUP_BETA_PASSED',
            'RUNNING_TASKS_CONFIRMED',
            'COMPLETION_CONTEXT_CONFIRMED',
          ],
        'outcome': 'completed',
      },
    'forbid': { 'tools': ['task_status'] },
  }
---

Start these two finite release checks concurrently in the background:

- `node -e 'setTimeout(() => console.log("GROUP_ALPHA_PASSED"), 12000)'`
- `node -e 'setTimeout(() => console.log("GROUP_BETA_PASSED"), 18000)'`

Use await_tasks to group their task IDs, with this reason:
"Compare both release checks before recommending deployment."
On your next model turn after grouping, check the transient running-tasks notice for both IDs,
titles, the grouping reason, start timestamps and shared group ID. If all those fields are present,
remember RUNNING_TASKS_CONFIRMED for your final reply; never infer the fields from earlier tool
calls. Then run pwd as independent work. Once that is done, end your turn without tool calls to wait
for the combined results; do not poll task_status. After both results arrive, report each check's
output and exit status and whether deployment is safe based on those checks.
Also report the completion reason, earliest start timestamp, aggregate duration in milliseconds,
and user-message count from the combined notice's completion context. Include
COMPLETION_CONTEXT_CONFIRMED only if all those fields arrived with the results; do not infer
missing measurements from tool calls or your own memory.
