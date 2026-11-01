# Sessions and sub-agents

Every run is a **session** with an id. The main session is the one the host starts; a
**sub-agent** is a nested agent loop started by a session, as a tool call. Every sub-agent is
linked to the session that started it, and through it to the main session, so none can float
on its own or get lost.

## Sessions

`SessionRegistry` (`src/runtime/sessions/`) holds the session tree of one main run. A session
is a `SessionRef` (`packages/core/src/session/`):

| Field      | What it is                                                    |
| ---------- | ------------------------------------------------------------- |
| `id`       | Unique (a UUID)                                               |
| `parentId` | The session that started it; absent only for the main session |
| `rootId`   | The main session at the top of the tree                       |
| `depth`    | 1 for the main session, 2 for its sub-agents, 3 for theirs    |

The registry also keeps each session's `title`, last reported `status`, `state` (`running`, or
how the run ended: `completed`, `interrupted`, `max_turns`, `failed`) and timestamps.

- `startMain` starts the main session; `startChild({ parentId, title })` starts a sub-agent. It
  throws if the parent is unknown, has ended, or is at the depth cap.
- `lineage(id)` walks a session up to the main session; `children(id)` lists the ones it started.
- A run takes `session: { registry, ref }`. Without one it starts its own main session. Either
  way the loop ends the session with the run's outcome, and the `done` event carries its ref.
- Tools get the calling session as `context.session`.

## Sub-agents

`createSubAgentTool(options)` (`src/tools/sub-agent/`) is the `start_agent` tool: it starts a
sub-agent on one task, `{ title, task }`.

- **A background task.** The sub-agent runs as a task in the parent's `TaskRegistry`, so the
  parent sees it with `task_status`, stops it with `cancel_task` (its session ends as
  `interrupted`), and is told its final reply when it finishes, like any background command.
- **Three levels, hard cap.** Main session → sub-agent → sub-agent (`MAX_SESSION_DEPTH = 3`).
  Below the cap a sub-agent gets `start_agent` too; at depth 3 it doesn't, and the registry
  refuses a fourth level regardless.
- **The parent chooses.** `options.tools` and `options.hooks` are what sub-agents get; the
  parent's own hooks are not inherited unless listed. Each sub-agent runs its own `sessionStart`.
  `options.instructions` are added after the built-in sub-agent rules.
- **Its own context.** A sub-agent sees only its task, not the parent's conversation.
- The loop's `runSession` is passed in as `options.runAgent`: tools can't import the loop.

## Status reporting

Every sub-agent gets `report_status({ status })`, and its instructions tell it to call it
before it starts and at each new step: "reading files, reading core package", then "editing
core package", then "updating ESLint rules". It's the sub-agent saying what it does, not the
harness watching its tool calls.

Each report updates the session in the registry, which tells its listeners
(`sessions.subscribe`) and adds a `[status] …` line to the task's output for the parent.

## Messages and steering

Every session has an **inbox** in the registry, addressed by session id. A message waits there
and is delivered at the session's next model call, without stopping anything: no abort, no
cancel, the current step finishes first. This is how the user steers the main session, and how a
parent steers a running sub-agent ("research dogs", then "focus specifically on puppies").

- **Sending:** `sessions.send({ id, content, from })`. `from` is `'user'`, or the id of the
  sending session, which must be an ancestor of the target: a session steers only its own
  sub-agents (and theirs), never a sibling or its parent. Ended sessions refuse messages.
- **The tool:** `message_agent({ session, message })` (`createMessageAgentTool`) sends from the
  calling session. `start_agent` returns the sub-agent's session id for it. Sub-agents below the
  depth cap get the tool too, for their own sub-agents.
- **Delivery:** at the start of each turn, after finished tasks are reported, the loop takes the
  inbox and adds each message to history as a user message. A message from a parent says so, so
  the sub-agent knows it's an update to its task. Each one is a `message_received` event in that
  session's own ordered event stream.
- **Idle sessions wake up:** a run waiting for background tasks (`waitForTasks`) also wakes on a
  new message. A run about to finish takes one more turn if a message arrived meanwhile.

For the user steering a sub-agent through the main session: the user messages the main session,
which decides whether to pass it on with `message_agent`. That keeps the main session in charge
of its sub-agents. A host could also call `sessions.send` with `from: 'user'` directly.

## Streaming to a UI: server-sent events

Status lines are small and live, so they're pushed, not polled. `sessions.stream({ signal })`
is a `text/event-stream` body:

```ts
new Response(sessions.stream({ signal }), { headers: { 'content-type': 'text/event-stream' } });
```

It starts with every known session (a UI that connects late catches up), then sends updates
until `signal` aborts. Each event is named `session_started`, `session_status`,
`session_message` or `session_ended`, and has the session id as its event id. Its JSON data is
`{ session }` (the `SessionInfo`), plus `message` for `session_message`. The demo prints the same
updates, indented by depth.

**Ordering.** Each session's own events (text, tool calls, results, `message_received`) go
through that session's `OrderedQueue`. A sub-agent's events stay in its own stream: the parent
sees only `start_agent`'s result and, later, `task_completed` with the final reply. The registry
feed (status, messages, start and end) is separate and has no `seq`. One combined ordering
across sessions isn't built yet.

Not built yet: an HTTP server that serves the stream (the demo is a CLI).
