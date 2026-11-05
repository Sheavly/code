# The demo

One prompt, a real model, every tool, printed as it happens: `npm run demo -- "your prompt"`. It calls the real API and costs money (a fraction of a cent for a short prompt). Its prompt waits
for the background tasks it started before it ends (Ctrl+C stops waiting).

## Settings

What a run includes and how it's set up are [the backend's settings](../../backend/docs/serve.md#settings),
passed in the environment to the backend the demo starts: `WORKSPACE_ROOT`, `SHOW_MODEL_CALLS`,
`SHEAVLY_HOME` and `SHEAVLY_TRUST_FILE`. The models and keys it runs on
are in your profile (`~/.sheavly`), not here: see
[models and keys](../../backend/docs/harness.md#models-and-keys). The
`--trust` flag trusts the workspace's `.sheavly/` hooks: `npm run demo -- --trust "your prompt"`.
The demo's own:

- `SESSIONS_SSE_LOG=<file>`: writes the conversation's stream, as a UI reads it, to a file.

## The backend

The chat, the demo and the workbook each start a backend of their own (`npm run serve` of
`@sheavly/backend`, on a free port with a token made for it) and stop it on the way out, even
when killed: its stdin is a pipe from the terminal, and it stops when that closes. Its output
(skills that didn't load, model calls with `SHOW_MODEL_CALLS`) shows in the terminal.

To use a backend that's already running instead (another UI's, or one on another machine), set
`BACKEND_URL` and `BACKEND_TOKEN`: the terminal then starts nothing and leaves it running, and that
backend's own settings decide the run.
