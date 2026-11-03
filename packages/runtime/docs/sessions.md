# Sessions

Every run is a **session** with an id. The main session is the one the UI starts; a **sub-agent** is a nested agent loop started by a session, as a tool call. Every sub-agent is linked to the session that started it, and through it to the main session, so none can float on its own or get lost. The `start_agent`, `report_status` and `message_agent` tools are in [@sheavly/tools](../../tools/docs/sub-agents.md).

## Sessions

`SessionRegistry` (`@sheavly/runtime/sessions/`) holds the session tree of one main run. A session
is a `SessionRef` (`packages/protocol/src/session/`):

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
- Every refusal is a `SessionError` (`@sheavly/runtime/errors/`) with a `reason` (`unknown_session`,
  `parent_ended`, `too_deep`, `session_ended`, `not_an_ancestor`) and the `sessionId` it was
  about, so a caller tells the cases apart without reading the message.
- `lineage(id)` walks a session up to the main session; `children(id)` lists the ones it started.
- A run takes `session: { registry, ref }`. Without one it starts its own main session. Either
  way the loop ends the session with the run's outcome, and the `done` event carries its ref.
- Tools get the calling session as `context.session`.

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
through that session's `OrderedQueue`, with that session's `seq`. The registry also orders the
whole tree: `sessions.subscribeEntries(listener)` gets a `StreamEntry`
(`@sheavly/protocol/stream/`) for every session update and for every event any session's loop
releases (the loop calls `sessions.publish`), sub-agents included, in the order they happened.
Each entry has one `seq` across the tree (0, 1, 2, ... with no gaps), the `sessionId` it is
about, and the event or update. An event keeps its own session's `seq` too, so a UI can still
follow one session alone.

A UI picks what it follows with the second argument:

- nothing: every session's entries, the whole tree;
- `{ sessionId }`: one session alone, e.g. a sub-agent's panel, in that session's order;
- `{ sessionId, subtree: true }`: a session and every sub-agent under it;
- `replay: true` (with any of these): first every matching entry since the run started, then
  live, so a panel opened late still starts at the beginning. The registry keeps the run's
  entries for this, for as long as it lives.

Following only the main session needs none of this: the main run's own `streamAgent` stream
has only its events, and its sub-agents work in the background (shown by their session updates).
Each entry a listener gets is a frozen copy, so a listener can't change what the run holds. A
listener that throws doesn't reach the run or the other listeners; its error is rethrown on its
own as an uncaught error, so it still fails loudly.

Not built yet: an HTTP server that serves the combined stream (the demo is a CLI).
