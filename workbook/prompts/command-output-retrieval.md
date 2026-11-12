---
description: A command prints far more than its preview keeps, and the model finds the hidden middle line through its output_ref instead of rerunning the command
workspace: basic
maxTurns: 6
check:
  {
    'areas':
      [
        'packages/core/src/output',
        'packages/tools/src/output',
        'packages/storage/src/output-store',
        'packages/coding/src/run-command',
        'packages/runtime/src/tasks',
        'apps/backend/src/harness/harness.helper.ts',
      ],
    'expect':
      {
        'outcome': 'completed',
        'tools': ['run_command', 'search_output'],
        'toolResults':
          { 'run_command': ['output_ref=', 'lines omitted'], 'search_output': ['1 match'] },
        'reply': ['found-it'],
      },
    'forbid': { 'toolErrors': { 'search_output': ['.'], 'read_output': ['.'] } },
  }
---

Run this one command once, exactly as written:

`node -e "for(let i=0;i<5000;i++)console.log(i===2500?'NEEDLE-'+'7731':'line '+i)"`

Its output is long and the result shows only a shortened preview. Do not run the command a second
time. Find the line that starts with `NEEDLE-` using the output reference from the result, then reply
with `found-it` and the number after `NEEDLE-`.
