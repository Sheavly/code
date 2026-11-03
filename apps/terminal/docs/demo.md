# The demo

One prompt, a real model, every tool, printed as it happens: `npm run demo -- "your prompt"`. It calls the real API and costs money (a fraction of a cent for a short prompt).

## Settings

- `WORKSPACE_ROOT=<dir>`: where the file tools, AGENTS.md and `.sheavly/` hooks are read from.
- `SHOW_MODEL_CALLS=true`: prints every model call (main session and sub-agents) with its tools,
  system prompt and latest user message.
- `SESSIONS_SSE_LOG=<file>`: writes the session server-sent event stream (what a UI would read)
  to a file.
- `SHEAVLY_TRUST_FILE=<file>`: where trusted workspaces are remembered (default
  `~/.config/sheavly/trusted-workspaces.json`). The `--trust` flag trusts the workspace's
  `.sheavly/` hooks: `npm run demo -- --trust "your prompt"`.
