---
description: Smoke check of model calls and tool-result replay with output-limit recovery enabled
maxTurns: 4
check:
  {
    'areas':
      [
        'packages/loop/src/stream-agent',
        'packages/providers/src/anthropic-messages',
        'packages/providers/src/azure/anthropic.adapter.ts',
        'apps/terminal/src/workbook/check.validator.ts',
        'apps/terminal/src/workbook/workbook.validator.ts',
      ],
    'expect':
      { 'outcome': 'completed', 'reply': ['output-check-complete'], 'tools': ['run_command'] },
  }
---

Run `pwd` once. After receiving its result, reply with exactly `output-check-complete`.
Do not run the command a second time.
