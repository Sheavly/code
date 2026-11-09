# @sheavly/backend

The harness backend: it builds each conversation from its settings (provider and model, tools,
hooks, workspace trust) and serves them to every UI over HTTP. This is where a run's choices
live; a UI decides only how to show it, and none is built into the backend.

```bash
npm run serve -w @sheavly/backend                  # from source; prints the URL and a token
```

It calls the real model API, so it costs money. The models and keys it uses are the user's, in
`~/.sheavly` (see [models and keys](docs/harness.md#models-and-keys)), not in the environment or a
`.env`. A UI that starts its own backend (the terminal does) passes its settings in the environment and reads the
`→ listening on <url>` line it prints once ready.
Conversation details include cumulative reported token usage and recorded cost estimates, across
main and sub-agent sessions. Optional model `pricing` supplies USD per million token rates for
ordinary input, output, cache reads and cache writes; missing rates remain unknown. Optional model
`contextWindow` is the window the agent is told, any positive size: 300,000 tokens when unset,
and UIs offer "300K" and "1M".

| Folder     | What it holds                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `harness/` | What a run includes (`createBackendHarness`), each served conversation (`servedConversation`), the settings |
| `api/`     | The HTTP API (`createApiApp`): every route of `API_ROUTES` with its handler, the token, SSE, errors         |
| `serve.ts` | The entry point: settings, `Conversations`, the API, and shutting it all down                               |

## Docs

- [Serving conversations](docs/serve.md): its settings, how a UI starts it, an example with `curl`.
- [The API](docs/api.md): the routes, streams, resuming, approvals, errors and security.
- [What a run includes](docs/harness.md): the tools, hooks and settings, and why here.
