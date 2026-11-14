---
description: two sub-agents run background commands at once; every task id in the run is different
workspace: basic
maxTurns: 14
check:
  {
    'areas':
      [
        'packages/runtime/src/tasks',
        'packages/tools/src/sub-agent',
        'packages/tools/src/tasks',
        'packages/loop/src/stream-agent',
        'packages/host/src/host',
        'packages/coding/src/run-command',
      ],
    'expect':
      {
        'tools': ['start_agent', 'await_tasks'],
        'events': ['task_running'],
        'reply': ['SHARED_IDS_LISTED', '/IDS: t\d+, t\d+, t\d+, t\d+/'],
        'outcome': 'completed',
      },
    'forbid': { 'reply': ['/IDS: .*\b(t\d+)\b.*\b\1\b/'] },
  }
---

Use start_agent twice, at the same time, to start two sub-agents:

- "Echo one" with exactly this task: Start `node -e 'setTimeout(() => console.log("ONE_DONE"), 8000)'` as a background command with run_command, and note the task id its result gives (a name like t3). Wait for it, then reply with exactly: TASK_ID=<that id> and the command's output.
- "Echo two" with exactly this task: Start `node -e 'setTimeout(() => console.log("TWO_DONE"), 8000)'` as a background command with run_command, and note the task id its result gives (a name like t3). Wait for it, then reply with exactly: TASK_ID=<that id> and the command's output.

Group both sub-agents' task ids with await_tasks and wait for both reports. Then reply with one line `IDS: ` followed by the four task ids, comma separated: the id of each sub-agent's own task (from start_agent's result) and each TASK_ID its report gave. Add SHARED_IDS_LISTED after the line. Do not change an id to make them differ.
