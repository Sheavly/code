# @sheavly/loop

The agent loop: `streamAgent` runs one session's turns, calls the model, runs tool calls in
parallel inside the run's hooks, and emits typed events in causal order with a gap-free `seq`.
`runAgent` runs it to the end and returns the history; `runSession` is the same for a sub-agent.
It knows the core contracts and the runtime registries, and nothing about files, workspaces or
which tools a run has.
Each attempted model call emits one `usage` event before its `turn_end`, including failed or
interrupted calls with unknown usage. These statistics are for UIs and are not model history.

The model receives context counts as a typed harness notice, formatted by its provider with
explicit telemetry attribution and silent-use guidance. Notices stay outside stored history and
system instructions. The same data is emitted as a `harness_notice` event for UIs, which choose
their own presentation; existing usage events are unchanged. See [context usage](docs/run.md#context-usage).

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

| Module          | What it holds                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stream-agent/` | `streamAgent`, `runAgent`, `runSession`: the turn, one model call, tool calls                                                                       |
| `errors/`       | `StreamEndedError` (the stream ended without `done`), `HookError`, `InvalidHistoryError` (a `beforeModelCall` result that breaks the history rules) |

Internal (closed in `exports`): `events/` (the event bodies), `queue/` (the `OrderedQueue` every
event goes through), `hooks/` (running each hook point), `history/` (`assertValidHistory`, the
one check for the messages a model call sends) and `abort/`.

## Docs

After cleanup and error hooks, a failed run emits `run_failed` before its failed session update.
It carries the error message, session and selected diagnostic details. The iterator still throws
the original exception. Diagnostics can be linked to the originating user message through the
session stream, never inserted into model history.

- [A run](docs/run.md): one run from start to end, hook order, interrupts and failures.
