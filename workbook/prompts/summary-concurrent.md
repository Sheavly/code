---
description: Summaries fire while a background task and a sub-agent are running; the request and facts survive, completion notices are not mistaken for requests, and both results still arrive
workspace: summary-quality
maxTurns: 40
contextWindow: 16000
check:
  {
    'areas':
      [
        'packages/loop/src/summary',
        'packages/summary/src',
        'packages/core/src/summary',
        'packages/tools/src/tasks',
        'packages/tools/src/sub-agent',
        'apps/backend/src/harness/summary.helper.ts',
      ],
    'expect':
      {
        'events': ['summary_done', 'task_completed'],
        'reply': ['PELICAN-7421', 'BG_DONE_9913', 'SUB_DONE_5530', 'Marta'],
        'tools': ['run_command', 'start_agent', 'read_file'],
        'transcript': ['/^✓ t[0-9]+ completed · exit 0 · .*BG_DONE_9913/m'],
        'outcome': 'completed',
      },
    'forbid': { 'transcript': ["couldn't summarize", 'invalid history'] },
  }
---

Remember this code word, it matters at the end: PELICAN-7421.

First start this finite check in the background with run_command:
`node -e 'setTimeout(() => console.log("BG_DONE_9913"), 45000)'`

Then use start_agent to start one sub-agent titled "Owner lookup" with exactly this task: Read
notes/decisions.md with read_file, then reply with SUB_DONE_5530 and the name of the person who owns
the decision.

While both are running, read src/big.ts completely with read_file, in five parts of 300 lines (lines
1 to 300, 301 to 600, and so on up to 1500), one part per call, and do that whole read four times in
a row. The harness manages your context and
shortens earlier work when it fills up, so do not stop early because of the context figure. Do not
edit files, and do not poll the background task.

Finish only after the background check has exited and the sub-agent has replied. Then reply with the
code word from the start, the background check's output, the sub-agent's reply, and the owner's name.
