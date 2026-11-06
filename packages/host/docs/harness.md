# The services a run shares

Why `createHarness` adds no tools or hooks, and how a UI composes a run on what it returns.

## Why it includes nothing

The packages provide the pieces and the services a run shares; a UI decides which provider a run
uses and which tools and hooks it includes, and composes them. No package picks a backend, a model,
a tool or a hook for it.

| Services                                  | For                                                                  | What it makes                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `createHarness` (`@sheavly/host`)         | Any LLM project: text parsing and extraction, chat wrappers, no repo | The session, task and approval registries a run shares, around the provider the UI picked. Opens no workspace and reads no file      |
| `createCodingHarness` (`@sheavly/coding`) | A coding agent in a repo                                             | `createHarness`'s services, plus the opened `Workspace`, one `FileLocks` and one `ProcessRunner` built from the env the UI passes in |

The UI builds its tools and hooks on those: `createTaskTools(tasks)`, `createSubAgentTool({ … })`
and `createMessageAgentTool` (`@sheavly/tools`); a coding UI's `createReadFileTool({ workspace })`,
`createRunCommandTool({ processes, … })` and the rest (`@sheavly/coding`); `createAgentsMdHook`
and, if it trusts the workspace, `loadProjectHooks` (`@sheavly/workspace`). The backend does it in
one place, `createBackendHarness` (`apps/backend/src/harness/`), with its settings from env.

```ts
const harness = createHarness({ provider, title: prompt });

for await (const event of streamAgent({
  provider: harness.provider,
  tools: [extractTool, ...createTaskTools(harness.tasks)],
  hooks: [],
  messages: [{ role: 'user', content: prompt }],
  tasks: harness.tasks,
  session: { registry: harness.sessions, ref: harness.mainSession },
}))
  render(event);
```

Pass `tasks` or `approvals` in when a tool needs the registry before the harness exists. Either
way, `createHarness` puts their updates in the sessions' combined stream (`kind: 'approval'` and
`kind: 'task'`), so a UI following the stream sees them without asking.

## A conversation across prompts

A UI the user keeps talking to wraps its harness in `createConversation({ harness, run: streamAgent,
tools, hooks })` (`@sheavly/host/conversation/`). Every `send(prompt, { signal })` runs the next
prompt on the history so far, in the harness's main session, and yields its events:

- Between prompts the session is `idle` (a `session_idle` update, with how the prompt ended as
  `lastOutcome`), and the next prompt resumes it (`session_resumed`); it never ends on its own.
- A prompt sent while one runs is refused with a `SessionError` (`session_running`); steering a
  running prompt is `sessions.send`.
- Aborting `signal` stops that prompt with valid history, and the next continues from it. A failed
  run keeps the user's prompt, added context, completed assistant turns and tool results. Tool
  effects are not undone by a provider failure, so history must not roll back either.
- Background tasks outlive a prompt; those that finish meanwhile are reported at the next one.
- `close()` ends the live conversation: it stops the running prompt, cancels background tasks (and
  their processes) and ends the session. It deletes nothing: `messages` stays readable, and
  `createConversation({ …, messages })` continues it in a new one.

Keeping a conversation across process restarts (saving `messages`) is the UI's to do.

## Generic, and coding on top

Generic code never needs a project on disk or a coding tool.
The loop, the generic runtime services (`sessions`, `tasks`, `approvals`), the generic tools
(`sub-agent`, `tasks`) and `createHarness` import none of the workspace-bound services
(`workspace`, `file-locks`, `process`, `trust`, `project-hooks`, `agents-md`) or the coding tools
(`read-file`, `write-file`, `edit-file`, `files`, `run-command`), and neither do their tests. Only
a coding UI reaches them, which is why each lives in a package of its own and the generic ones
never depend on the coding ones.
