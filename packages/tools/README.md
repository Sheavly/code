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
import { createWebSearchTool } from '@sheavly/tools/web-search/web-search.tool';
import { createTavilySearchBackend } from '@sheavly/tools/web-search-backends/tavily-search.helper';

const tools = [
  createWebFetchTool(),
  // The app explicitly selects a backend; the search tool has no default.
  createWebSearchTool({ backend: createTavilySearchBackend() }),
  ...createTaskTools(harness.tasks),
  createSubAgentTool({ sessions, tasks, provider, runAgent: runSession, tools: [] }),
];
```

| Module                 | Tools                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `tasks/`               | `task_status`, `await_tasks`, `cancel_task`: inspect, group and stop background tasks                                              |
| `sub-agent/`           | `start_agent`, `report_status`, `message_agent`: sub-agents, and steering them                                                     |
| `web-fetch/`           | `web_fetch`: bounded public HTTP(S) reading, HTML as Markdown, no credentials                                                      |
| `web-search/`          | `web_search`, `SearchBackend`, `WebSearchArtifact`, `isWebSearchArtifact`: provider-neutral search with bounded structured results |
| `web-search-backends/` | `createTavilySearchBackend`, `TavilySearchOptions`: app-selected concrete search transports                                        |

The package exports `tool`, `helper`, `types` and `utils` kinds, not individual files. Besides
factories and contracts, the existing modules' helpers and utilities are reachable by their defining
subpaths: web-fetch address, body, request and content handling; sub-agent instructions and selection
helpers; and search execution, bounding and artifact validation. Their signatures and doc comments
state the constraints for direct use. Apps normally use the tool factories, supply trusted
transport dependencies and use the artifact guard rather than composing low-level operations.
`testing/` exposes source-only HTTP fakes for tests, never production network fallbacks.

## Docs

`task_status` returns an immediate snapshot for inspection, not a wait. Running snapshots remind
the agent to finish independent work and yield without tool calls rather than poll. Required task
results arrive automatically through the loop; services need not exit before a prompt finishes.
`await_tasks({ ids, reason })` registers a group immediately and holds its completion notices until
all members finish. Its required reason explains the dependent decision or next step to the agent's
future self after a summary, rather than merely saying "waiting for results".

- [Sub-agents](docs/sub-agents.md): starting them, what they get, status reporting.
- [The task tools](docs/tasks.md): checking on and stopping background work.
- [Web fetch](docs/web-fetch.md): limits, content types, address and domain rules, cancellation.
- [Web search](docs/web-search.md): selecting a backend, Tavily access, structured results and failures.
