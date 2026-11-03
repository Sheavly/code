---
description: run_command, a background task, and task_status
workspace: basic
check:
  {
    'areas':
      [
        'packages/runtime/src/tasks',
        'packages/tools/src/tasks',
        'packages/coding/src/run-command',
        'packages/workspace/src/process',
      ],
    'expect':
      {
        'tools': ['run_command', 'task_status'],
        'events': ['task_running'],
        'outcome': 'completed',
      },
  }
---

Run pwd. Also start 'ls -la src' as a background task, then check its status with task_status and tell me what it printed.
