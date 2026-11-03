# @sheavly/server

The harness over HTTP: Hono routes that serve a host's conversations to UIs in other processes,
with SSE streams and a typed client. A transport (`sheavly.transport`): only apps depend on it,
so the library always runs in-process without it. It adds no behaviour of its own: each route is
one call on the host's `Conversations`.

```ts
import { serve } from '@hono/node-server';
import { Conversations } from '@sheavly/host/conversations/conversations.service';
import { createServerApp } from '@sheavly/server/server/server.helper';

const conversations = new Conversations({ create: buildConversation }); // the app's choice
const app = createServerApp({ conversations, token });

serve({ fetch: app.fetch, hostname: '127.0.0.1', port });
```

| Module    | What it holds                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `server/` | `createServerApp`: the routes, the bearer token, body limits, errors                                                        |
| `client/` | `createServerClient`: a client built from `API_ROUTES`, every call typed and parsed; `readEntries`: an SSE stream's entries |
| `errors/` | `ServerRefusedError` (the server's `code`) and `ServerAnswerError` (an answer off the contract)                             |

## Docs

- [Design](docs/design.md): the routes, streams, resuming, approvals, errors and security.
