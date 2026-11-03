# @sheavly/loop

The agent loop: `streamAgent` runs one session's turns, calls the model, runs tool calls in
parallel inside the run's hooks, and emits typed events in causal order with a gap-free `seq`.
`runAgent` runs it to the end and returns the history; `runSession` is the same for a sub-agent.
It knows the core contracts and the runtime registries, and nothing about files, workspaces or
which tools a run has.

```ts
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';

for await (const event of streamAgent({
  provider,
  tools,
  hooks,
  messages,
  signal,
  tasks,
  session,
})) {
  render(event);
}
```

| Module          | What it holds                                                                 |
| --------------- | ----------------------------------------------------------------------------- |
| `stream-agent/` | `streamAgent`, `runAgent`, `runSession`: the turn, one model call, tool calls |

Internal: `events/` (the event bodies), `queue/` (the `OrderedQueue` every event goes through),
`hooks/` (running each hook point), `abort/` and `errors/` (`HookError`, `StreamEndedError`).

## Docs

- [A run](docs/run.md): one run from start to end, hook order, interrupts and failures.
