# @sheavly/client

The harness's HTTP client for UIs: every route of the API (`API_ROUTES`, in `@sheavly/protocol`),
its params and body typed and its answer parsed with the contract's schemas, and its server-sent
event streams. A transport (`sheavly.transport`): only apps depend on it, so the library always
runs in-process without it. The routes themselves are the backend's (`apps/backend`).

```ts
import { createClient } from '@sheavly/client/client/client.helper';

const client = createClient({ url, token });
const { id } = await client.call('startConversation', { body: {} });

for await (const entry of client.stream('sendPrompt', { id, body: { text: 'hi' } })) render(entry);
```

| Module       | What it holds                                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approvals/` | `watchApprovals` / `followApprovals`: a conversation's approvals, each with the sub-agent that asked (`HeardApproval`), learned from the stream, so a UI needn't build that itself |
| `client/`    | `createClient`: a client built from `API_ROUTES`, every call typed and parsed; `readEntries`: an SSE stream's entries; `reconnectingEntries`: a stream that resumes after a drop   |
| `errors/`    | `RefusedError` (the backend's `code`), `AnswerError` (an answer off the contract) and `StreamLostError` (a stream it gave up reconnecting)                                         |
| `testing`    | `fakeServer`: a `fetch` that answers the routes as a UI's test says, checked against the contract                                                                                  |

## Docs

- [Design](docs/design.md): the calls, errors, testing a UI on the fake, other languages.
