---
description: Many medium reads fill a small window; old tool output is hidden from the model, and the run still answers from what it kept
workspace: basic
maxTurns: 40
contextWindow: 30000
check:
  {
    'areas':
      [
        'packages/loop/src/summary',
        'packages/loop/src/stream-agent/turn.helper.ts',
        'apps/backend/src/harness/summary.helper.ts',
      ],
    'expect':
      {
        'tools': ['read_file'],
        'reply': ['PELICAN-7421', 'value1500', '1500'],
        'outcome': 'completed',
      },
    'forbid': { 'transcript': ["couldn't summarize"] },
  }
---

Remember this code word, it matters at the end: PELICAN-7421.

Read src/big.ts with read_file in parts of 200 lines each, one read after the other and never two at
once: lines 1 to 200, then 201 to 400, and so on up to line 1500. Do all eight reads in that order.
The harness manages your context and hides earlier tool output when it fills up, so do not stop
early because of the context figure, and do not read a part again. Do not run commands or edit
files. Then reply with the code word from the start, the name of the last export, and its value.
