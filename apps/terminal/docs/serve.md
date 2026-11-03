# The server

Conversations served over HTTP, for a UI in another process (an editor, a web page, a script):
`npm run serve -w @sheavly/terminal`. Each conversation is built like the chat's, with the same
tools, hooks and skills and the same settings ([demo.md](demo.md): `ADAPTER` and its keys,
`MODEL`, `WORKSPACE_ROOT`, `RUN_COMMAND_SKIP_ALLOW_LIST`, `--trust`). It calls the real API, so it
costs money. The routes, streams and errors are in
[the server's design](../../../packages/server/docs/design.md).

| Setting        | Default      | What it does                                                   |
| -------------- | ------------ | -------------------------------------------------------------- |
| `SERVER_HOST`  | `127.0.0.1`  | Where it listens. It runs commands for whoever reaches it      |
| `SERVER_PORT`  | `4310`       | The port                                                       |
| `SERVER_TOKEN` | made per run | The bearer token every request carries; at least 32 characters |

Without `SERVER_TOKEN` it makes one and prints it once, at start. Ctrl+C (or SIGTERM, or closing
the terminal) stops it, and with it every conversation's prompts, background tasks and processes.

## An example session

```bash
T=<the token>
U=http://127.0.0.1:4310

# Start a conversation, or find the ones running (another UI may have started one).
curl -s -H "authorization: Bearer $T" $U/conversations
ID=$(curl -s -X POST -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{}' $U/conversations | jq -r .id)

# Send a prompt; its entries stream back as server-sent events until its `done`.
curl -N -X POST -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"text":"What is in this folder?"}' $U/conversations/$ID/prompts

# Follow the whole conversation from another terminal (QUERY, with a filter body).
curl -N -X QUERY -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"replay":true}' $U/conversations/$ID/stream

# The history, and the skills a prompt can run.
curl -s -H "authorization: Bearer $T" $U/conversations/$ID/messages
curl -s -H "authorization: Bearer $T" $U/conversations/$ID/skills

# Stop the running prompt, then close the conversation.
curl -X POST -H "authorization: Bearer $T" $U/conversations/$ID/stop
curl -X DELETE -H "authorization: Bearer $T" $U/conversations/$ID
```

A TypeScript UI uses the typed client instead: `createServerClient({ url, token })` from
`@sheavly/server/client/client.helper`.

## The same conversations in-process

The chat runs its conversation through the same `Conversations` (`@sheavly/host`) and the same
factory (`terminalConversation`, `src/harness/conversation.helper.ts`), in its own process, with
no server. The server adds no behaviour: a UI gets the same conversation either way.
