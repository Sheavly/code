# Serving conversations

`npm run serve -w @sheavly/backend` serves conversations over HTTP to any UI in another process:
the terminal, an editor, a web page, a script. Each conversation runs on its workspace's profile,
with its own switch between that profile's models (so changing its model leaves the others alone),
and the run [harness.md](harness.md) describes. The
routes, streams and errors are in [the API](api.md).

## Settings

| Setting                       | Default       | What it does                                                                                                                            |
| ----------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `SERVER_HOST`                 | `127.0.0.1`   | Where it listens. It runs commands for whoever reaches it                                                                               |
| `SERVER_PORT`                 | `4310`        | The port; `0` picks a free one                                                                                                          |
| `SERVER_TOKEN`                | made per run  | The bearer token every request carries; at least 32 characters                                                                          |
| `SERVER_EXIT_WITH_PARENT`     | off           | `true`: stop when stdin closes (the UI that started it is gone)                                                                         |
| `SERVER_ALLOW_REMOTE_SETUP`   | off           | `true`: take model keys and grant trust even when listening beyond this machine (`SERVER_HOST` not loopback); only behind TLS           |
| `WORKSPACE_ROOT`              | the folder    | The folder a conversation works in when its start names none: file tools, AGENTS.md, skills and `.sheavly/` hooks                       |
| `RUN_COMMAND_SKIP_ALLOW_LIST` | off           | `true`: `run_command` runs any shell command                                                                                            |
| `MAX_TURNS`                   | 20            | Model calls a prompt may make, per session                                                                                              |
| `WAIT_FOR_TASKS`              | off           | `true`: a prompt's `done` waits for its background tasks                                                                                |
| `MODEL_CALLS_FILE`            | none          | Appends each model call's full request there, one JSON line each                                                                        |
| `SHOW_MODEL_CALLS`            | off           | `true`: prints each model call (task, tools, system prompt) as sent                                                                     |
| `SHEAVLY_HOME`                | `~/.sheavly`  | The user's folder: profiles, models, keys, conversations and trusted workspaces                                                         |
| `SHEAVLY_TRUST_FILE`          | in the folder | Where trusted workspaces are remembered, if not `trusted-workspaces.json` in `SHEAVLY_HOME` (the workbook's checks use a throwaway one) |

The models and keys are in the user's profile, not here, and not in a `.env`: see
[models and keys](harness.md#models-and-keys). How a model call is sent (`MODEL_RESPONSE_TIMEOUT_MS`,
`MODEL_RETRIES`, `MODEL_RETRY_DELAY_MS`) is in [harness.md](harness.md#settings). `--trust` trusts
the workspace's `.sheavly/` hooks: `npm run serve -w @sheavly/backend -- --trust`.

Without `SERVER_TOKEN` it makes one and prints it once, at start. Once it listens it prints
`→ listening on <url>`, last. Ctrl+C, SIGTERM, closing the terminal or (with
`SERVER_EXIT_WITH_PARENT`) its stdin closing stops it, and with it every conversation's prompts,
background tasks and processes. Skills that didn't load, and each model call with
`SHOW_MODEL_CALLS`, go to stderr.

## A UI that starts its own

The terminal starts a backend for itself: `npm run serve` of this workspace, by package name, on
`127.0.0.1` with `SERVER_PORT=0`, a token it made, and `SERVER_EXIT_WITH_PARENT=true`, so the
backend stops when the terminal does, even killed. It reads the URL from the `listening` line. Any
UI can do the same, or connect to one already running.

## An example session

```bash
T=<the token>
U=http://127.0.0.1:4310

# Start a conversation, or find the ones running (another UI may have started one).
curl -s -H "authorization: Bearer $T" $U/conversations
ID=$(curl -s -X POST -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{}' $U/conversations | jq -r .id)

# What the run is: workspace, models, trust.
curl -s -H "authorization: Bearer $T" $U/conversations/$ID

# Send a prompt; its entries stream back as server-sent events until its `done`.
curl -N -X POST -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"text":"What is in this folder?"}' $U/conversations/$ID/prompts

# Follow the whole conversation from another terminal (QUERY, with a filter body), answering
# approvals: without a client that says `approvals: true`, an approval is refused at once.
curl -N -X QUERY -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"replay":true,"approvals":true}' $U/conversations/$ID/stream

# The history, and the skills a prompt can run (all, or those a search matches).
curl -s -H "authorization: Bearer $T" $U/conversations/$ID/messages
curl -s -X QUERY -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"search":"review"}' $U/conversations/$ID/skills

# Stop the running prompt, then close the conversation.
curl -X POST -H "authorization: Bearer $T" $U/conversations/$ID/stop
curl -X DELETE -H "authorization: Bearer $T" $U/conversations/$ID
```

A TypeScript UI uses the typed client instead: `createClient({ url, token })` from
`@sheavly/client/client/client.helper`, with `readEntries` for the streams.
