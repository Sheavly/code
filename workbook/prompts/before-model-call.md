---
description: A project beforeModelCall hook hides older tool output for one call, and the run still completes
workspace: before-model-call
maxTurns: 10
check:
  {
    'areas':
      [
        'packages/core/src/hook',
        'packages/loop/src/hooks',
        'packages/loop/src/history',
        'packages/loop/src/errors/loop.errors.ts',
        'packages/loop/src/stream-agent/turn.helper.ts',
        'extensions/coding/src/project-hooks',
        'apps/terminal/src/render',
      ],
    'expect':
      {
        'events': ['model_input_changed'],
        'transcript': ['hide-output changed this call'],
        'reply': ['BRAVO'],
        'tools': ['read_file'],
        'outcome': 'completed',
      },
    'forbid': { 'transcript': ['hooks not loaded', 'produced invalid history'] },
  }
---

Read a.txt with read_file. Only after you have its result, read b.txt with read_file. Then reply
with the code word that b.txt states, in capitals. Do not run commands or edit files.
