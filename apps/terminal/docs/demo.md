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

## Several models on Azure

`MODELS` names the models to set up, comma-separated; the run starts on the first, and the chat's
`/model <name>` switches between them (from the next model call; the conversation keeps its
history). Each name's keys are named after it, upper-cased with `-` as `_` (`deepseek-flash` reads
`DEEPSEEK_FLASH_*`), so each model has its own key, endpoint and deployment:

- `<NAME>_ADAPTER`: `azure` (the Responses API: GPT, DeepSeek and other Foundry models) or
  `azure-anthropic` (Claude).
- `<NAME>_API_KEY`, `<NAME>_BASE_URL`, `<NAME>_DEPLOYMENT`: required.
- `azure` only: `<NAME>_API_VERSION` (for a dated URL) and `<NAME>_REASONING` (`false` for a model
  that sends no encrypted reasoning back; default `true`).
- `azure-anthropic` only: `<NAME>_MAX_TOKENS` (default 16000) and `<NAME>_THINKING_BUDGET`
  (extended thinking, at least 1024; unset = off).

With `MODELS` set, `ADAPTER` and its keys are not read. The example `.env` has one of each.
