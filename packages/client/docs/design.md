# Design

How a UI calls the backend: one client built from the API's routes (`API_ROUTES`,
`@sheavly/protocol/api/`), the same table the backend's routes follow, so the two can't drift
apart without a type error. What each route does is [the backend's API](../../../apps/backend/docs/api.md).

## Calls

Each route is one call by name, its path params and body typed from the contract's schemas,
`QUERY` included:

```ts
const client = createClient({ url, token });
const { id } = await client.call('startConversation', { body: {} });
const { skills } = await client.call('querySkills', { id, body: { search: 'review' } });

for await (const entry of client.stream('sendPrompt', { id, body: { text: 'hi' } })) render(entry);
```

- `call`: a route that answers JSON. The answer is parsed with the route's schema, so ids keep
  their brands, and one off the contract throws `AnswerError`.
- `send`: a route that answers nothing (`204`).
- `stream`: a route's server-sent events, as entries (`readEntries`: each `entry` frame parsed
  with `streamEntrySchema`, heartbeats skipped). `open` hands back the raw stream, to save.
- A refused request throws `RefusedError`, with the backend's `code` (`not_found`,
  `unknown_model`, …) to branch on.

The token goes in a header on every request, never in a URL. `fetch` can be passed in: a proxy,
or a test's fake.

## Approvals

An approval names the session that asked by id only (the stream entry's `sessionId`); a
sub-agent's title, depth and parent live in the `session_*` updates, the one place they are
kept. `watchApprovals` (`approvals/`) opens the stream as one that answers approvals, replays it
from the start so sub-agents already running are known, and calls `onApproval` with a
`HeardApproval`: the `update`, the `sessionId`, and `agent` (that sub-agent's last snapshot) when
a sub-agent asked. The id is always there; whether and how to show `agent` is the UI's choice.
`followApprovals` does the same over any stream of entries. A replay also re-sends approvals
already answered, each followed by its answer, so key a UI by the approval's id.

## Testing a UI

`fakeServer(handlers)` (`testing/`) is a `fetch` that answers the API's routes as a test says:
each request is matched to its route in `API_ROUTES`, a JSON answer is checked against the route's
schema (so a fake can't answer what the real backend couldn't), and `calls` records what was sent.
A UI tests its own logic on it; the real routes are tested end to end in the backend.

## Other languages

A client in another language reads `openapi.json` (`@sheavly/protocol`), written from the same
table. It isn't generated into this package: the generators don't yet read OpenAPI 3.2's `QUERY`
or its stream `itemSchema`, which three of the routes use.
