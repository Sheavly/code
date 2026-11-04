# @sheavly/backend

The harness backend: it builds each conversation from its settings (provider and model, tools,
hooks, workspace trust) and serves them to every UI over HTTP, the terminal included. This is
where a run's choices live; a UI decides only how to show it.

```bash
npm run serve -w @sheavly/backend                  # from source; prints the URL and a token
```

It calls the real model API, so it costs money. Settings come from the environment, or `.env` in
the folder it is started from (`ADAPTER`, the backend's keys, `MODEL`). A UI that starts its own
backend (the terminal does) passes its settings in the environment and reads the
`→ listening on <url>` line it prints once ready.

| Folder     | What it holds                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `harness/` | What a run includes (`createTerminalHarness`), each served conversation (`servedConversation`), the settings |
| `api/`     | The HTTP API (`createApiApp`): every route of `API_ROUTES` with its handler, the token, SSE, errors          |
| `serve.ts` | The entry point: settings, `Conversations`, the API, and shutting it all down                                |

## Docs

- [Serving conversations](docs/serve.md): its settings, how a UI starts it, an example with `curl`.
- [The API](docs/api.md): the routes, streams, resuming, approvals, errors and security.
- [What a run includes](docs/harness.md): the tools, hooks and settings, and why here.
