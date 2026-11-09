---
description: Smoke check of model calls and tool-result replay with silent harness notices
maxTurns: 4
check:
  {
    'areas':
      [
        'packages/core/src/notice',
        'packages/protocol/src/notice',
        'packages/loop/src/stream-agent',
        'packages/providers/src/anthropic-messages',
        'packages/providers/src/azure/anthropic.adapter.ts',
        'apps/terminal/src/workbook/check.validator.ts',
        'apps/terminal/src/workbook/workbook.validator.ts',
      ],
    'expect':
      { 'outcome': 'completed', 'reply': ['output-check-complete'], 'tools': ['run_command'] },
    'forbid': { 'transcript': ['harness-notice', 'output continuation', 'output-token limit'] },
  }
---

Run `pwd` once. After receiving its result, reply with exactly `output-check-complete`.
Do not run the command a second time.
