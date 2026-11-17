---
description: a persistent service started with start_service, then stopped with cancel_task
workspace: basic
maxTurns: 10
check:
  {
    'areas':
      [
        'extensions/coding/src/run-command',
        'packages/tools/src/tasks',
        'packages/loop/src/stream-agent',
        'apps/backend/src/harness',
      ],
    'expect':
      {
        'tools': ['start_service', 'cancel_task'],
        'events': ['task_running'],
        'reply': ['SERVICE_STOPPED'],
        'outcome': 'completed',
      },
    'forbid': { 'tools': ['task_status'] },
  }
---

Start this long-running process as a service, not as a finite check:

- `node -e 'setInterval(() => {}, 1000)'`

Do not wait for it to exit. As soon as it has started, stop it with cancel_task, then reply with
the single word SERVICE_STOPPED.
