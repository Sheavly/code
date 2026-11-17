---
description: a sub-agent cannot cancel or list its parent's running command
workspace: basic
maxTurns: 14
check:
  {
    'areas':
      [
        'packages/runtime/src/tasks',
        'packages/tools/src/tasks',
        'packages/tools/src/sub-agent',
        'packages/loop/src/stream-agent',
        'extensions/coding/src/run-command',
      ],
    'expect':
      {
        'tools': ['run_command', 'start_agent'],
        'reply': ['/No task with id t\d+/', 'PARENT_STILL_RUNNING'],
        'outcome': 'completed',
      },
    'forbid': { 'reply': ['/Cancelled task t\d+/'] },
  }
---

Start `node -e 'setTimeout(() => console.log("PARENT_DONE"), 40000)'` as a background command with run_command, and note its task id (a name like t1).

Then use start_agent to start one sub-agent titled "Intruder" with exactly this task: Call task_status with no id and copy its whole answer word for word. Then call cancel_task with the id <the task id you noted> and copy its whole answer word for word. Then finish.

Wait for the sub-agent's report with await_tasks on its task id (not the command's), and quote both of its answers exactly. Then call task_status with the id you noted. If that command is still running, say PARENT_STILL_RUNNING. Do not cancel anything yourself.
