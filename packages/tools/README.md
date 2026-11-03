# @sheavly/tools

The generic tools: nothing about files or commands, so any LLM project can include them. A UI
picks which ones a run gets and builds them on the run's registries.

```ts
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';

const tools = [
  ...createTaskTools(harness.tasks),
  createSubAgentTool({ sessions, tasks, provider, runAgent: runSession, tools: [] }),
];
```

| Module       | Tools                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| `tasks/`     | `task_status`, `cancel_task`: check on and stop background tasks               |
| `sub-agent/` | `start_agent`, `report_status`, `message_agent`: sub-agents, and steering them |

## Docs

- [Sub-agents](docs/sub-agents.md): starting them, what they get, status reporting.
- [The task tools](docs/tasks.md): checking on and stopping background work.
