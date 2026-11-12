---
description: A long run on a small window is summarized several times; no summary fails, and facts given at the start survive every one
workspace: basic
maxTurns: 40
contextWindow: 30000
check:
  {
    'areas':
      [
        'packages/loop/src/summary',
        'packages/summary/src',
        'packages/core/src/summary',
        'packages/loop/src/stream-agent/turn.helper.ts',
        'apps/backend/src/harness/summary.helper.ts',
      ],
    'expect':
      {
        'events': ['summary_done'],
        'transcript': ['/summarized chat[\s\S]*summarized chat/'],
        'reply': ['PELICAN-7421', '1500', '777'],
        'tools': ['read_file'],
        'outcome': 'completed',
      },
    'forbid': { 'transcript': ["couldn't summarize"] },
  }
---

Remember this code word, it matters at the end: PELICAN-7421.

Read src/big.ts completely with read_file, in two parts each time: lines 1 to 1000, then lines 1001
to 1500. Do that read six times in a row, one full pass after the other, and do not skip a pass:
the harness manages your context and shortens earlier work when it fills up, so do not stop early
because of the context figure. Do not run commands or edit files. Then reply with the code word
from the start, the value of the last export, and what value777 is set to.
