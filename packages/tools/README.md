# @sheavly/tools

The generic tools: nothing about files or commands, so any LLM project can include them. A UI
picks which ones a run gets and builds them on the run's registries.

`createSubAgentTool` optionally accepts `selectProvider`, called when an agent starts, to capture
the parent's provider and model/mode selection. The child and its descendants retain that snapshot
when the main conversation later switches. A supplied selection is recorded on the child's session.
Pass `baseInstructions` to share host guidance before the child role. Child `instructions` remain
extras after that role; the factory neither imports host prompt text nor copies parent history.
The compact child role covers assignment scope, status reporting, parent steering and a useful
handoff. Shared guidance is injected once rather than repeated in that role.

```ts
import { createTaskTools } from '@sheavly/tools/tasks/tasks.tool';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { createWebFetchTool } from '@sheavly/tools/web-fetch/web-fetch.tool';

const tools = [
  createWebFetchTool(),
  ...createTaskTools(harness.tasks),
  createSubAgentTool({ sessions, tasks, provider, runAgent: runSession, tools: [] }),
];
```

| Module       | Tools                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| `tasks/`     | `task_status`, `cancel_task`: check on and stop background tasks               |
| `sub-agent/` | `start_agent`, `report_status`, `message_agent`: sub-agents, and steering them |
| `web-fetch/` | `web_fetch`: bounded public HTTP(S) reading, HTML as Markdown, no credentials  |

## Docs

`task_status` returns an immediate snapshot for inspection, not a wait. Running snapshots remind
the agent to finish independent work and yield without tool calls rather than poll. Required task
results arrive automatically through the loop; services need not exit before a prompt finishes.

- [Sub-agents](docs/sub-agents.md): starting them, what they get, status reporting.
- [The task tools](docs/tasks.md): checking on and stopping background work.
- [Web fetch](docs/web-fetch.md): limits, content types, address and domain rules, cancellation.
