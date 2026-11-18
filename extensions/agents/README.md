# @sheavly/agents

Sub-agents, the background task tools, command output reading and history search, as one extension that other extensions share their tools with.

`createAgentsExtension` adds the task tools (`task_status`, `await_tasks`, `cancel_task`),
`read_output` and `search_output` (when the host supplies an output store), `start_agent` with
`message_agent` and the history tools (with `logOf`). It is generic: nothing here knows about files
or commands. It reads the run's scoped services from the run services
(`@sheavly/host/run-services/run-services.utils`) in `activate`, as any extension can, so the host
must supply them (`runServices`): `SESSION_INFO`, `CHILD_SESSIONS`, `BACKGROUND_TASKS`,
`TASK_CONTROL`, `MODEL`, `INSTRUCTIONS` and, with an output store, `OUTPUT_READER`. It holds no
registry and does not import the loop: `CHILD_SESSIONS` runs a sub-agent's loop. Its options are
the embedding app's choices only: `subAgentProvider`, `summarizeWith`, `keepAgentHistory` and
`logOf`. It provides `SUB_AGENTS`, a write-only service: an extension that depends on `agents`
shares the tools and hooks its sub-agents get with `share`, and cannot read or change what others
shared. Its `sheavly.json` declares the services it requires
(`session-info`, `child-sessions`, `background-tasks`, `task-control`, `model`, `instructions`),
reads optionally (`output-reader`) and provides (`sub-agents`), every grant it uses
(`session:read`, `sub-agent:create`, `sub-agent:message`, `sub-agent:observe`,
`sub-agent:report`, `task:start`, `task:read`, `task:cancel`, `task:read-any`,
`task:cancel-any`, `model:call`, `output:read`: what each allows is in
[scoped run services](../../packages/host/docs/run-services.md)) and every tool it can contribute
under any option; the host holds it to that.

```ts
import { createAgentsExtension } from '@sheavly/agents/agents/agents.helper';
import { SUB_AGENTS } from '@sheavly/agents/agents/agents.utils';

const agents = createAgentsExtension({ subAgentProvider, logOf });
// In another extension whose sheavly.json lists "agents" in dependsOn:
//   services.get(SUB_AGENTS).share({ tools, taskTools, hooks });
```

| Module    | What it holds                                                                                |
| --------- | -------------------------------------------------------------------------------------------- |
| `agents/` | `createAgentsExtension`, `SUB_AGENTS`, `createSubAgentScope` and the options and share types |

## Docs

- [Design](docs/design.md): how it works, and how to extend it.
