# @sheavly/protocol

The wire contract: everything the harness sends a UI or accepts from one (`AgentEvent`,
`SessionUpdate`, `StreamEntry`, `ApprovalUpdate`, `ApprovalResponse` and the types inside them), as zod schemas.
Every type is `z.infer` of its schema, so the types and what goes over the wire can't drift. It
depends on zod only.

```ts
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { agentEventSchema } from '@sheavly/protocol/event/event.validator';
```

A client in another language reads `contract.schema.json`, the whole contract as one JSON Schema,
or `openapi.json`, the HTTP API as an OpenAPI 3.2 document. After changing a schema or a route,
run `npm run schema -w @sheavly/protocol`; a test fails while either file is out of date.

| Module      | What it holds                                                                |
| ----------- | ---------------------------------------------------------------------------- |
| `event/`    | The loop's `AgentEvent`s and the `ToolArtifact` they carry                   |
| `session/`  | `SessionRef`, `SessionInfo`, the `SessionUpdate` stream                      |
| `stream/`   | `StreamEntry`: every session's events and updates, in one order              |
| `approval/` | `ApprovalRequest`, `ApprovalUpdate`, `ApprovalResponse`                      |
| `task/`     | Background task states                                                       |
| `message/`  | The conversation history, and the `PromptPart`s a user typed                 |
| `skill/`    | `SkillInfo`: a skill as a UI lists it                                        |
| `server/`   | The server's requests, responses and `ServerError` codes                     |
| `api/`      | `API_ROUTES`: every HTTP route's method, path and schemas; `openApiDocument` |
| `contract/` | `contract.schema.json`, generated from the schemas                           |

## Docs

- [The wire contract](docs/contract.md): what is in it, what stays out, and how it is checked.
