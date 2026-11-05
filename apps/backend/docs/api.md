# The API

How a UI in another process talks to the harness: over HTTP, to the conversations a
`Conversations` (`@sheavly/host`) keeps. The routes add nothing to what an in-process UI gets by
calling `Conversations` itself; they turn requests into calls and results into responses. They
live in `src/api/`, one handler per route of `API_ROUTES` (`@sheavly/protocol/api/`): the table
gives each its method, path and body schema, `ApiHandlers` makes a missing handler a type error,
and a test fails for any route the app doesn't serve. A UI calls them with `@sheavly/client`'s
client, built from the same table.

## Routes

Every route is under `/conversations`, `/stored-conversations` (the ones kept on disk, live or
not), or the setup's own roots (`/setup`, `/adapters`, `/profiles`, `/default-profile`), and every
request carries `Authorization: Bearer <token>`.

| Request                                                            | Answer                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `GET /conversations`                                               | `{ conversations }`: each live one, oldest first                                                  |
| `POST /conversations`, `{ messages?, workspace?, profile? }`       | `201 { id }`: a new conversation, continuing `messages`, in `workspace` on `profile`              |
| `GET /conversations/:id`                                           | its run: workspace, models, trust, the permission mode                                            |
| `PUT /conversations/:id/model`, `{ id }`                           | `204`: one of its models, by id, from the next model call                                         |
| `POST /conversations/:id/prompts`                                  | the prompt's entries as SSE, ending with its `done`                                               |
| `QUERY /conversations/:id/stream`                                  | every entry, as SSE, while the client stays                                                       |
| `POST /conversations/:id/stop`                                     | `204`: the running prompt stops; history stays valid                                              |
| `POST /conversations/:id/approvals/:approval`                      | `204`: the waiting approval is answered                                                           |
| `GET /conversations/:id/messages`                                  | `{ messages }`: the history, valid to continue from                                               |
| `QUERY /conversations/:id/skills`, `{ search? }`                   | `{ skills }`: what a prompt can run, for a `/` menu                                               |
| `DELETE /conversations/:id`                                        | `204`: its prompts, tasks and processes stop; it's gone                                           |
| `QUERY /stored-conversations`, `{ search?, workspace?, profile? }` | `{ conversations }`: every folder's and profile's, or those a title matches or that belong to one |
| `POST /stored-conversations/:id/reopen`                            | `{ id }`: a kept one is live again, from its history                                              |

### Setting the backend up

A first run has no profile, so `POST /conversations` answers `409 not_set_up` until a profile has a
model that can be used. A UI sets that up with these routes, and nothing in the user's folder needs
editing by hand. Every id is a lowercase UUID the client makes (`crypto.randomUUID()`), so a `PUT`
is safe to repeat; a name is a label for people. A profile is the user's setting (work, personal):
its models and keys are its own, and a conversation sees only its profile's.

| Request                                                                 | Answer                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /setup`                                                            | the home folder, every profile with its models, the default                     |
| `GET /adapters`                                                         | what each adapter takes, as JSON Schema, with its secrets marked                |
| `GET /profiles/:profile`                                                | one profile; `ready` says a conversation can start on it                        |
| `PUT /profiles/:profile`, `{ name }`                                    | `204`: made, or renamed                                                         |
| `DELETE /profiles/:profile`                                             | `204`: gone with its models, keys and conversations                             |
| `PUT /default-profile`, `{ profile }`                                   | `204`: where nothing else is chosen                                             |
| `QUERY /workspace-profiles`, `{ workspace }`                            | `{ workspace, profile?, bound }`: what a folder runs on and why                 |
| `PUT /workspace-profiles`, `{ workspace, profile }`                     | `204`: the folder always runs on this profile                                   |
| `POST /workspace-profiles/unbind`, `{ workspace }`                      | `204`: the folder runs on the default again                                     |
| `QUERY /trusted-workspaces`, `{ search? }`                              | `{ workspaces }`: each trusted folder, when, and `trusted`, `changed` or `gone` |
| `POST /trusted-workspaces`, `{ workspace }`                             | `204`: its `.sheavly/` hooks run as they are now                                |
| `POST /trusted-workspaces/revoke`, `{ workspace }`                      | `204`: they stop running; also for a folder that is gone                        |
| `QUERY /profiles/:profile/models`, `{ search? }`                        | `{ models }`: by name, adapter or provider-side model                           |
| `GET /profiles/:profile/models/:model`                                  | one model, its key state and whether it is `usable`                             |
| `PUT /profiles/:profile/models/:model`, `{ name, adapter, definition }` | `204`: checked by its adapter, never with a secret                              |
| `DELETE /profiles/:profile/models/:model`                               | `204`: the model and its key                                                    |
| `PUT /profiles/:profile/credentials/:model`, `{ secrets }`              | `204`: write-only, replaces the model's secrets                                 |
| `DELETE /profiles/:profile/credentials/:model`                          | `204`: forgets the secrets, keeps the model                                     |
| `POST /profiles/:profile/credentials/:model/check`                      | `{ status }`: one tiny call with the stored key                                 |

- **A key is write-only.** No route answers with one, and no error, log line or stored file other
  than the profile's credentials holds it. A model's `credential` is `missing`, `set` or
  `not_needed` (its adapter has no secret): never the value.
- **Access is handed out only on this machine.** A key, and a grant of trust, are what make the
  backend run something on the caller's say-so. Listening on `127.0.0.1`, `::1` or `localhost` is
  fine; on any other address, the credential routes (set, forget and check) and `POST
/trusted-workspaces` answer `403 forbidden`, so neither crosses a network the backend can't vouch
  for. Taking access away (forgetting a key, revoking trust) and looking are never refused.
  `SERVER_ALLOW_REMOTE_SETUP=true` allows it, which belongs only behind TLS.
- **A model is checked before it is stored.** Its adapter refuses fields it doesn't have and a
  key where a model's fields go (`422`, saying which field and never quoting a value).
- **Deleting a profile deletes its conversations.** There is no undo, so a UI should ask first.
- **A folder is named by its path**, in the body (a UI knows the path; the config keeps a hash of
  its real path, so a symlink or a trailing slash is the same folder). It is checked as a
  conversation's workspace is (see "Several conversations at once"), so a folder that couldn't be
  worked in can't be bound or trusted; only `revoke` takes a path that no longer exists.
- **A folder runs on** the profile it is bound to, else the default (`QUERY /workspace-profiles`
  says which: `bound`). A binding to a profile that was deleted counts as none.
- **Trusting a folder makes its `.sheavly/` hooks run**, which is code from the repo, so it is the
  user's call and asks the same locality as a key. It trusts the hooks as they are now: a later
  change to `.sheavly/` makes the entry `changed` and the hooks stop until it is trusted again.
  The trust is kept outside every repo, so a repo can't trust itself.

Bodies are the protocol's schemas (`@sheavly/protocol/server/`), validated with the same objects a
client parses with. A prompt is `{ text }` (`/<name>` mentions run skills) or `{ parts }` (exactly
the skills picked), never both.

Methods follow what each request is. A read with no input is `GET`; a read with input is `QUERY`
(RFC 10008: safe, idempotent, with a body), never a query string: a filter, a search or a resume
point is a typed body (the stream's filter, the skills' search). Setting a value is `PUT` (the
model: sending it twice is the same as once); anything else that changes state is `POST` or
`DELETE`, so no client or proxy retries it on its own. Each route of `API_ROUTES` declares whether
it reads or changes, and its type allows only the methods that fit; adding one is "A route" in the
project skill.

`GET /conversations/:id` is what the backend reports about the run it built (the host knows
nothing of workspaces or models): a conversation that reports nothing answers `not_found`.

### Several conversations at once

One backend serves any number of conversations, each in its own folder on its own profile, and
several in one folder. A start says where (`workspace`, `profile`); what it leaves out is decided
once, then fixed for the conversation's life and kept with it:

- **`workspace`** is an absolute path to an existing folder (symlinks followed; the backend's own
  folder, `WORKSPACE_ROOT`, when omitted). It is refused (`422 bad_request`) when it is not
  absolute, not there, not a folder, the root of a file system, the home folder (the agent can
  change everything inside its workspace), or holds or sits inside the folder where profiles and
  keys are kept.
- **`profile`** is a profile's id. Left out, it is the profile the folder is bound to, else the
  default. An id no profile has is `422 bad_request`, and no profile at all is `409 not_set_up`.
- **Where it is kept.** Under `profiles/<profile>/workspaces/<folder>/conversations/<id>/`, so a
  profile's conversations of different folders never mix, and a restart finds every one of them.
  `GET /conversations/:id` and `QUERY /stored-conversations` say which folder and profile each
  belongs to, and the stored query filters by either.
- **Reopening** puts a conversation back in the folder and on the profile it was kept with, not
  where a new one would go now. A folder deleted since is refused (`422`) and the conversation is
  kept.
- **What several share.** The file locks (edits to one file by any of them take turns, whichever
  profile each runs on). Everything else is its own: models, keys, sessions, history, stream and
  what the agent has read (an edit needs a read by the same conversation).
- **What they don't share yet.** Two conversations editing one file can still work from different
  views of it: the locks keep each write whole, not the two agents agreed.

## Streams

Both SSE answers send the same frames: `event: entry`, `id: <seq>`, `data: <StreamEntry JSON>`.
`seq` counts the conversation's whole combined stream with no gaps, so a client knows when it
missed one.

- A prompt's response is that prompt: its first entry is the session resuming (or starting), its
  last the main session's `done`. A script sends a prompt and reads its answer in one request.
- `QUERY /stream` follows the whole conversation: every prompt, sub-agents, approvals and
  background tasks starting and ending (`kind: 'task'`, under the session whose tool started
  one). Its body filters it (`session`, with `subtree` the session's sub-agents too) and `replay`
  sends it from the start first. `Last-Event-ID: <seq>` resumes right after the last entry a
  client got.
- A `done` in the stream carries no history; `GET /messages` has it.
- A quiet stream gets a `: heartbeat` comment every 15 seconds, and `X-Accel-Buffering: no`, so a
  proxy in between neither closes nor buffers it.

A client leaving ends its stream, never the prompt: a prompt runs to its end, and `POST /stop`
stops one. Closing the conversation (`DELETE`), or `serve.ts` calling `conversations.closeAll()`
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
| 422    | `unknown_model`    | `PUT /model` named an id the conversation hasn't       |
| 500    | `internal`         | the server failed; the message never holds its details |

A prompt that can't start is answered with an error before its stream opens.

## Security

- `serve.ts` binds to `127.0.0.1` by default: the backend runs commands for whoever reaches it.
- The token is compared in constant time, sent only in a header (the stream is `QUERY` read with
  `fetch`, never `EventSource`, so it is never in a URL), and never logged.
- `internal` errors never carry their message: it can hold paths or a provider's reply.

## Hosting it elsewhere

The API is built so it can move off localhost later: the bind address is a setting, the token is
only ever a header, a dropped stream resumes with `Last-Event-ID`, and the routes are web-standard
`Request`/`Response`. What hosting it for others still needs (TLS, users, a sandbox per
workspace) is still to come.
