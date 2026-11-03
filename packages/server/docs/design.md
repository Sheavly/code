# Design

How a UI in another process talks to the harness: over HTTP on localhost, to the conversations
a `Conversations` (`@sheavly/host`) keeps. The routes add nothing to what an in-process UI gets
by calling `Conversations` itself; they turn requests into calls and results into responses.

## Routes

Every route is under `/conversations`, and every request carries `Authorization: Bearer <token>`.

| Request                                       | Answer                                                  |
| --------------------------------------------- | ------------------------------------------------------- |
| `GET /conversations`                          | `{ conversations }`: each live one, oldest first        |
| `POST /conversations`, `{ messages? }`        | `201 { id }`: a new conversation, continuing `messages` |
| `GET /conversations/:id`                      | its run: workspace, models, trust, the allow list       |
| `PUT /conversations/:id/model`, `{ name }`    | `204`: one of its models, from the next model call      |
| `POST /conversations/:id/prompts`             | the prompt's entries as SSE, ending with its `done`     |
| `QUERY /conversations/:id/stream`             | every entry, as SSE, while the client stays             |
| `POST /conversations/:id/stop`                | `204`: the running prompt stops; history stays valid    |
| `POST /conversations/:id/approvals/:approval` | `204`: the waiting approval is answered                 |
| `GET /conversations/:id/messages`             | `{ messages }`: the history, valid to continue from     |
| `GET /conversations/:id/skills`               | `{ skills }`: what a prompt can run, for a `/` menu     |
| `DELETE /conversations/:id`                   | `204`: its prompts, tasks and processes stop; it's gone |

Bodies are the protocol's schemas (`@sheavly/protocol/server/`), validated with the same objects a
client imports. A prompt is `{ text }` (`/<name>` mentions run skills) or `{ parts }` (exactly the
skills picked), never both.

Methods follow what each request is. A read with no input is `GET`; a read with input is `QUERY`
(RFC 10008: safe, idempotent, with a body); setting a value is `PUT` (the model: sending it twice
is the same as once); anything else that changes state is `POST` or `DELETE`, so no client or
proxy retries it on its own.

`GET /conversations/:id` is what the app reports about the run it built (the host knows nothing of
workspaces or models): a conversation whose app reports nothing answers `not_found`.

## Streams

Both SSE answers send the same frames: `event: entry`, `id: <seq>`, `data: <StreamEntry JSON>`.
`seq` counts the conversation's whole combined stream with no gaps, so a client knows when it
missed one.

- A prompt's response is that prompt: its first entry is the session resuming (or starting), its
  last the main session's `done`. A script sends a prompt and reads its answer in one request.
- `QUERY /stream` follows the whole conversation: every prompt, sub-agents, approvals and
  background tasks starting and ending (`kind: 'task'`, under the session whose tool started one).
  Its body
  filters it (`session`, with `subtree` the session's sub-agents too) and `replay` sends it from the
  start first. `Last-Event-ID: <seq>` resumes right after the last entry a client got.
- A `done` in the stream carries no history; `GET /messages` has it.
- A quiet stream gets a `: heartbeat` comment every 15 seconds, and `X-Accel-Buffering: no`, so a
  proxy in between neither closes nor buffers it.

A client leaving ends its stream, never the prompt: a prompt runs to its end, and `POST /stop`
stops one. Closing the conversation (`DELETE`), or the app calling `conversations.closeAll()`
when it stops, stops its prompts, tasks and processes.

## Several UIs on one conversation

An editor and an agent window can be views of one conversation. One starts it; the other finds it
with `GET /conversations` (each entry has its `id`, `title`, main `session`, whether it is
`running`, and `startedAt`) and opens its own `QUERY /stream`, with `replay` to catch up. Each
then sees every prompt either sends, live and in the same order. Either can send the next prompt:
a second one while the first runs gets `409 session_running`. Either can answer an approval: the
first answer counts, and a later one gets `unknown_approval`.

## Approvals

An approval a tool asks for is an entry in the stream (`kind: 'approval'`), in order with the
events of the call that asked. A client answers with `POST /approvals/:approval`. A client that
will answer says so when it opens the stream (`QUERY /stream` with `approvals: true`); while at
least one such stream is open, a request waits for an answer. With none open, it is refused at
once, as in a headless run: a script that only sends prompts, or a UI that never answers, never
leaves a run waiting on an approval no one will give.

## Errors

Every failure is `{ error: { code, message } }` (`ServerError`):

| Status | Code               | When                                                   |
| ------ | ------------------ | ------------------------------------------------------ |
| 400    | `bad_request`      | a body that doesn't parse, or over 5 MB                |
| 401    | `unauthorized`     | no token, or a wrong one                               |
| 404    | `not_found`        | no such conversation (or route), or one already closed |
| 404    | `unknown_approval` | no approval waiting with that id                       |
| 409    | `session_running`  | a prompt is still running in that conversation         |
| 422    | `unknown_skill`    | `parts` picked a skill no one has                      |
| 422    | `unknown_model`    | `PUT /model` named a model the conversation hasn't     |
| 500    | `internal`         | the server failed; the message never holds its details |

A prompt that can't start is answered with an error before its stream opens.

## Security

- The app binds the server to `127.0.0.1` by default: it runs commands for whoever reaches it.
- The token is compared in constant time, sent only in a header (the stream is `QUERY` read with
  `fetch`, never `EventSource`, so it is never in a URL), and never logged.
- `internal` errors never carry their message: it can hold paths or a provider's reply.

## The typed client

`createServerClient({ url, token })` is Hono's `hc<ServerApp>`: each route's request and response
is typed from the routes themselves, so a TypeScript UI can't send a wrong body. SSE answers are
read with `readEntries(response.body)` (`client/entries.helper`): each `entry` frame, parsed with
`streamEntrySchema`, skipping heartbeats.

## Hosting it elsewhere

The server is built so it can move off localhost later: the bind address is the app's setting, the
token is only ever a header, a dropped stream resumes with `Last-Event-ID`, and the routes are
web-standard `Request`/`Response`. What hosting it for others still needs (TLS, users, a sandbox per
workspace, keeping conversations across restarts) is outside this package.
