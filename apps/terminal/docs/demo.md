# The demo

One prompt, a real model, every tool, printed as it happens: `npm run demo -- "your prompt"`. It calls the real API and costs money (a fraction of a cent for a short prompt).

## Settings

- `WORKSPACE_ROOT=<dir>`: where the file tools, AGENTS.md and `.sheavly/` hooks are read from.
- `SHOW_MODEL_CALLS=true`: prints every model call (main session and sub-agents) with its tools,
  system prompt and latest user message.
- `SESSIONS_SSE_LOG=<file>`: writes the session server-sent event stream (what a UI would read)
  to a file.
- `MODEL_RESPONSE_TIMEOUT_MS`, `MODEL_RETRIES`, `MODEL_RETRY_DELAY_MS`: how a model call is sent
  (default 60000, 2 and 1000: wait a minute for a response to start, and retry twice before
  anything streamed). See [sending a call](../../../packages/providers/docs/backends.md#sending-a-call-timeouts-and-retries).
- `SHEAVLY_TRUST_FILE=<file>`: where trusted workspaces are remembered (default
  `~/.config/sheavly/trusted-workspaces.json`). The `--trust` flag trusts the workspace's
  `.sheavly/` hooks: `npm run demo -- --trust "your prompt"`.
