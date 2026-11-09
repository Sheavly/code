# Sessions

Every run is a **session** with an id. The main session is the one the UI starts; a **sub-agent** is a nested agent loop started by a session, as a tool call. Every sub-agent is linked to the session that started it, and through it to the main session, so none can float on its own or get lost. The `start_agent`, `report_status` and `message_agent` tools are in [@sheavly/tools](../../tools/docs/sub-agents.md).

## Message correlation

Before a new user prompt, the host calls `sessions.setMessage({ sessionId, messageId })`.
Subsequent stream entries carry that ID. A child inherits its parent's current ID when it starts;
later parent prompts do not reassign existing children. Restoring the stream rebuilds associations
from every entry, not only its retained tail. Legacy entries without IDs remain valid. The identity
is diagnostic metadata, never model input.

## Sessions

`SessionRegistry` (`@sheavly/runtime/sessions/`) holds the session tree of one main run. A session
is a `SessionRef` (`packages/protocol/src/session/`):

| Field      | What it is                                                    |
| ---------- | ------------------------------------------------------------- |
| `id`       | Unique (a UUID)                                               |
| `parentId` | The session that started it; absent only for the main session |
| `rootId`   | The main session at the top of the tree                       |
| `depth`    | 1 for the main session, 2 for its sub-agents, 3 for theirs    |

The registry also keeps each session's `title`, last reported `status`, `state` (`running`;
`idle` between the prompts of a conversation; or how it ended: `completed`, `interrupted`,
`max_turns`, `failed`), `lastOutcome` (how its last run ended), `modelId` and timestamps.

A session's model is its own: `setModel({ id, modelId })` records it at the session's start and at
each switch, and announces it as `session_model`. A sub-agent's never changes the main session's,
and the other way round. It is announced once per change, so the stream holds the history of
switches, and a restored conversation has each session's last model back. A session that has
ended refuses it (`session_ended`): its model is the one it ran on.

`setModel` also accepts `mode` (low, medium, high or extreme), mirrored on the session and in
`session_model`. A mode-only change is announced too; identical model-and-mode pairs are not.
Each session retains its own mode through the stored stream, independently of other sessions.

A session in a conversation goes `idle` when a prompt's run finishes (`sessions.idle({ id,
outcome })`, a `session_idle` update) and runs again for the next prompt (`sessions.resume(id)`,
`session_resumed`); `resume` refuses a session that is running (`session_running`) or ended.
While idle it accepts messages, kept for its next prompt, but no status reports or sub-agents.
`end` ends it from either state.

- `startMain` starts the main session; `startChild({ parentId, startedByCall, title })` starts a
  sub-agent, recording the tool call in the parent's history that started it. It
  throws if the parent is unknown, has ended, or is at the depth cap.
- Every refusal is a `SessionError` (`@sheavly/runtime/errors/`) with a `reason` (`unknown_session`,
  `parent_ended`, `too_deep`, `session_ended`, `session_running`, `not_an_ancestor`) and the `sessionId` it was
  about, so a caller tells the cases apart without reading the message.
- `lineage(id)` walks a session up to the main session; `children(id)` lists the ones it started.
- A run takes `session: { registry, ref }`. Without one it starts its own main session. Either
  way the loop ends the session with the run's outcome, and the `done` event carries its ref.
- Tools get the calling session as `context.session`.

## Conversations: one session across prompts

A UI the user keeps talking to runs every prompt in the same main session. `createConversation`
(`@sheavly/host`, see [a conversation across prompts](../../host/docs/harness.md#a-conversation-across-prompts))
does it on this registry: each prompt's run uses `keepSession`, so the loop leaves the session
`idle` when it finishes (however it ended) instead of ending it, and the next prompt `resume`s
it. In between, messages sent to it wait for the next prompt, and its background tasks keep
running and are reported then. The session ends only when the conversation closes, with how its
last prompt ended. One prompt runs at a time: `resume` refuses a running session
(`session_running`).

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
`session_message`, `session_idle`, `session_resumed`, `session_model` or `session_ended`, and has the session id as its event id. Its JSON data is
`{ session }` (the `SessionInfo`), plus `message` for `session_message` and `modelId` for
`session_model`. The demo prints the same
updates, indented by depth.

**Ordering.** Each session's own events (text, tool calls, results, `message_received`) go
through that session's `OrderedQueue`, with that session's `seq`. The registry also orders the
whole tree: `sessions.subscribeEntries(listener)` gets a `StreamEntry`
(`@sheavly/protocol/stream/`) for every session update, for every event any session's loop
releases (the loop calls `sessions.publish`), sub-agents included, for every approval
update (`kind: 'approval'`) and for every background task starting and ending (`kind: 'task'`,
`sessions.publishTask`, under the session whose tool started it), in the order they happened.
`createHarness` wires the approval and task registries in; a sub-agent's own tasks join the same
stream. Each entry has one `seq` across the tree (0, 1, 2, ... with no gaps), the `sessionId` it is
about, and the event or update. An event keeps its own session's `seq` too, so a UI can still
follow one session alone.

A UI picks what it follows with the second argument:

- nothing: every session's entries, the whole tree;
- `{ sessionId }`: one session alone, e.g. a sub-agent's panel, in that session's order;
- `{ sessionId, subtree: true }`: a session and every sub-agent under it;
- `replay: true` (with any of these): first every matching entry since the run started, then
  live, so a panel opened late still starts at the beginning.

By default the registry keeps every entry for this, for as long as it lives. Given a `store`
(`new SessionRegistry({ store })`, an `EntryStore` from `@sheavly/core/store/`), it also writes
each entry to it in order and keeps only the newest `ENTRY_TAIL_SIZE` in memory, so a long
conversation's memory stays bounded. A replay that reaches further back than memory is read from
the store and delivered a moment later, in order and before any live entry; if the store can't
give every entry it should (a lost write), the replay stops and `subscribeEntries`' `onError`
hears a `StoreError`, rather than show a conversation with a hole in it. If a write fails, the
registry stops writing, keeps everything in memory from then on, and reports it as
`storageFailure`: whoever owns the conversation should stop it rather than let it go on unrecorded.

A stored conversation can be carried on: `SessionRegistry.readStoredLog(store)` reads its entries once, in order, and
`new SessionRegistry({ store, resume })` continues from there. Numbering carries on from the last
stored entry, the newest entries are the ones in memory, and every session is back as its last
update left it. The main session is idle for its next prompt (`restoredMain()` is its ref). A
sub-agent that was still open when the process ended is settled as `interrupted` and announced in
the stream: it is not run again, since what it was doing is gone. Stored entries with a gap throw
a `StoreError` instead of resuming a conversation with a hole in it.

The registry also keeps each session's last reported tokens: `lastTokens(id)` is what the session's
newest `usage` event carried, not a total. A call that reported none clears it, since the old
numbers no longer say how full the context is. It belongs to the session, not to a run, so a
conversation's next prompt (a new run on the same session) and a reopened conversation (read back
by `readStoredLog`) still have it. The loop uses it to tell the agent how full its context is.

A `done` in the combined stream has no `messages`, for live listeners and replay alike
(`EntryEvent` in `@sheavly/protocol`). Each prompt's `done` would otherwise hold the whole history
so far, and a kept log would grow with the square of a long conversation. The history comes from
whoever ran the loop: the run's own `done`, or `conversation.messages`. Without a store the log
still keeps every other entry, `text_delta`s included, for as long as the registry lives.

Following only the main session needs none of this: the main run's own `streamAgent` stream
has only its events, and its sub-agents work in the background (shown by their session updates).
Each entry a listener gets is a frozen copy, so a listener can't change what the run holds. A
listener that throws doesn't reach the run or the other listeners; its error is rethrown on its
own as an uncaught error, so it still fails loudly.

Not built yet: an HTTP server that serves the combined stream (the demo is a CLI).
