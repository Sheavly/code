---
description: Facts learned only from tool output (a decision and its owner, an error code, the next step) survive the summaries of a long run and are recalled without reading anything again
workspace: summary-quality
maxTurns: 40
contextWindow: 24000
check:
  {
    'areas':
      [
        'packages/summary/src',
        'packages/loop/src/summary',
        'packages/core/src/summary',
        'apps/backend/src/harness/summary.helper.ts',
      ],
    'expect':
      {
        'events': ['summary_done'],
        'reply': ['CSV', 'E-4471', 'Marta', '/semicolon/i'],
        'tools': ['read_file'],
        'outcome': 'completed',
      },
    'forbid':
      { 'tools': ['search_history', 'read_history_entry'], 'transcript': ["couldn't summarize"] },
  }
---

First read notes/decisions.md and notes/failures.md with read_file, one after the other. Then read
src/big.ts completely, in two parts, lines 1 to 1000 and lines 1001 to 1500, and do that whole read
four times in a row. The harness manages your context and shortens earlier work when it fills up, so
do not stop early because of the context figure. Do not run commands or edit files.

When the four reads are done, answer from memory: do not read any file again and do not search the
history. Tell me which export format was chosen and why, who owns that decision, the error code the
upload retries failed with, and the next step. If you no longer know one of them, write UNKNOWN for it
instead of guessing.
