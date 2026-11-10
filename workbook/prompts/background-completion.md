---
description: delayed finite background results without status polling
workspace: basic
maxTurns: 10
check:
  {
    'areas':
      [
        'packages/coding/src/run-command',
        'packages/tools/src/tasks',
        'packages/loop/src/stream-agent',
        'packages/host/src/instructions',
      ],
    'expect':
      {
        'tools': ['run_command'],
        'events': ['task_running', 'task_completed'],
        'reply': ['CI_ALPHA_PASSED', 'CI_BETA_PASSED'],
        'transcript':
          [
            '/^✓ t[0-9]+ completed · exit 0 · .*CI_ALPHA_PASSED/m',
            '/^✓ t[0-9]+ completed · exit 0 · .*CI_BETA_PASSED/m',
          ],
        'outcome': 'completed',
      },
    'forbid': { 'tools': ['task_status'] },
  }
---

Start these two finite checks concurrently in the background:

- `node -e 'setTimeout(() => console.log("CI_ALPHA_PASSED"), 12000)'`
- `node -e 'setTimeout(() => console.log("CI_BETA_PASSED"), 18000)'`

Also run pwd while they are working. Finish only after both checks have exited, and report each
check's output and exit status.
