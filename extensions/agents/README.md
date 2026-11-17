# @sheavly/agents

Sub-agents, the background task tools, command output reading and history search, as one extension that other extensions share their tools with.

`createAgentsExtension` adds the task tools (`task_status`, `await_tasks`, `cancel_task`),
`read_output` and `search_output` (when the host supplies `OUTPUTS`), `start_agent` with
`message_agent` and the history tools (with `logOf`). It is generic: nothing here knows about files
or commands. It reads the run's sessions, tasks, provider, instructions and outputs from the run
services (`@sheavly/host/run-services/run-services.utils`) in `activate`, as any extension can, so
the host must supply them (`runServices`). Its options are the embedding app's choices only:
`subAgentProvider`, `summarizeWith`, `keepAgentHistory` and `logOf`. It provides `SUB_AGENTS`: an
extension that depends on `agents` shares the tools and hooks its sub-agents get with `share`.
Its `sheavly.json` declares the services it requires (`sessions`, `tasks`, `provider`,
`instructions`), reads optionally (`outputs`) and provides (`sub-agents`), and every tool it can
contribute under any option; the host holds it to that.

```ts
import { createAgentsExtension } from '@sheavly/agents/agents/agents.helper';
import { SUB_AGENTS } from '@sheavly/agents/agents/agents.utils';

const agents = createAgentsExtension({ subAgentProvider, logOf });
// In another extension that declares dependsOn: ['agents']:
//   services.get(SUB_AGENTS).share({ tools, taskTools, hooks });
```

| Module    | What it holds                                                                                |
| --------- | -------------------------------------------------------------------------------------------- |
| `agents/` | `createAgentsExtension`, `SUB_AGENTS`, `createSubAgentScope` and the options and share types |

## Docs

- [Design](docs/design.md): how it works, and how to extend it.
