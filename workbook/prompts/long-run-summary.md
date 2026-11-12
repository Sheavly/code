---
description: One prompt and a long tool loop reach the summary trigger on a small window, and the run still finishes (a first summary may be rejected as not smaller, since the fixed tail is half of this window)
workspace: basic
maxTurns: 12
contextWindow: 16000
check:
  {
    'areas':
      [
        'packages/loop/src/summary',
        'packages/core/src/summary',
        'packages/loop/src/stream-agent/turn.helper.ts',
        'packages/summary/src',
        'packages/coding/src/trail',
        'apps/backend/src/harness/summary.helper.ts',
        'apps/backend/src/harness/settings.validator.ts',
        'apps/backend/src/usage/context-window.helper.ts',
        'apps/terminal/src/workbook/run-env.utils.ts',
      ],
    'expect':
      {
        'events': ['summary_started', 'summary_done'],
        'transcript': ['summarized chat'],
        'reply': ['1500', '42'],
        'tools': ['read_file'],
        'outcome': 'completed',
      },
  }
---

Read src/big.ts completely with read_file: first lines 1 to 1000, then lines 1001 to 1500. Then
read it completely a second time the same way, in the same two parts. Do all four reads: the
harness manages your context and shortens earlier work when it fills up, so do not stop early
because of the context figure. Do not run commands or edit files. Then reply with the value of the
last export and with what value42 is set to.
