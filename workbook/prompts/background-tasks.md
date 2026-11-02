---
description: run_command, a background task, and task_status
workspace: basic
check:
  {
    'areas':
      ['src/runtime/tasks', 'src/tools/tasks', 'src/tools/run-command', 'src/runtime/process'],
    'expect':
      {
        'tools': ['run_command', 'task_status'],
        'events': ['task_running'],
        'outcome': 'completed',
      },
  }
---

Run pwd. Also start 'ls -la src' as a background task, then check its status with task_status and tell me what it printed.
