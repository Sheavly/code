# The services a run shares

Why `createHarness` adds no tools or hooks, and how a UI composes a run on what it returns.

## Diagnostic message identity

New conversation prompts receive a stable user-message `id` before the session resumes. It is kept
in history and attached to stream activity as `messageId`, including failures and background sessions
started by that prompt. Providers do not send it to the model. Earlier messages without IDs remain
readable and are not renumbered on resume.

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
  instructions: harness.instructions,
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

## Instruction composition

`createHarness` returns stable `instructions` assembled by `composeInstructions`:
generic core, then host extras. Set `baseInstructions` to replace just the generic core;
omission uses the default and an empty string omits it. Blank sections are skipped, outer
whitespace is trimmed, and sections are joined with one blank line.

`createCodingHarness` inserts coding guidance between the core and host extras, even when the
core is replaced. Generic hosts receive no coding section and require no workspace.
`createConversation` uses the harness text unless its own `instructions` is explicitly supplied.
That existing option is a complete override, not an extension; an empty override remains empty.
Direct `streamAgent` or `runAgent` callers pass the returned string explicitly.

The generic core tells the agent to finish independent work, then yield without tool calls while
waiting for required background results. Status inspection is limited to requested updates or
diagnosis, not waiting. This rule belongs in stable system instructions as well as task-tool
guidance; models must not turn immediate snapshots into a wait loop. It names no particular tool
and applies equally to commands and sub-agent work.

The backend passes its composed shared text to the child factory; the child adds its role,
then any child-specific extras. Other hosts explicitly choose what children receive. Parent
conversation overrides and history are not implicitly inherited. All models use the same text,
including unknown families and pinned children; switching providers does not rebuild it.

Before-turn instruction additions follow static text through the loop. AGENTS.md and skills
remain deduplicated append-only conversation context, preserving signed-thinking prefixes.
Replacing prose never changes tools, permission checks or project hooks.

## A conversation across prompts

A UI the user keeps talking to wraps its harness in `createConversation({ harness, run: streamAgent,
tools, hooks })` (`@sheavly/host/conversation/`). Every `send(prompt, { signal })` runs the next
prompt on the history so far, in the harness's main session, and yields its events:

- Between prompts the session is `idle` (a `session_idle` update, with how the prompt ended as
  `lastOutcome`), and the next prompt resumes it (`session_resumed`); it never ends on its own.
- A normal prompt sent while one runs is refused with a `SessionError` (`session_running`).
  `conversation.followup(text)` instead synchronously attempts user steering through
  `sessions.send({ id: mainSession.id, from: 'user', content: text })`. Accepted messages wake a
  finite-task or sub-agent wait without cancelling anything, and are delivered in inbox order at
  the next model call (`message_received`). Idle or stopping/completing prompts return `false`;
  closed conversations throw `session_ended`. Terminal limits close intake before `done` is
  queued; idle session state closes it before the iterator's cleanup clears `running`.
- `conversations.followup({ id, prompt })` prepares text or picked skill parts just as normal
  `send` does, then rechecks the original run's identity, stopping state and storage health.
  Preparation finishing after a run cannot steer a subsequent prompt. A UI queues its original
  prompt as a normal send when acceptance is false; the host does not start that fallback itself.
  Expanded skill text is kept, but the inbox contract carries neither original parts nor a new
  diagnostic message ID: stream activity remains associated with the active prompt.
- Accepted follow-ups are queued for history persistence immediately: the preview contains the
  previous finished history, current prompt and accepted follow-ups. In-flight model/tool work
  remains in the separately persisted stream; it joins the history snapshot when the run ends
  or fails, as for a normal prompt. An interrupt, failure or turn limit may prevent model delivery;
  remaining inbox messages are then kept once in valid final history and cleared from the inbox,
  so the next normal prompt sees them without duplicate delivery. Acceptance is not a promise of
  a model response after abort or a terminal limit.
- Aborting `signal` stops that prompt with valid history, and the next continues from it. A failed
  run keeps the user's prompt, added context, completed assistant turns and tool results. Tool
  effects are not undone by a provider failure, so history must not roll back either.
- Finite background tasks, including sub-agents, keep the prompt alive and resume the model
  automatically with their completions. Persistent services do not keep it active and may outlive
  a prompt; their completions are reported at the next model call.
  Aborting a prompt cancels its background work, including services, sub-agents and their
  descendants. Individual cancellations remain visible in the combined task/session stream,
  but do not create completion notices for the next prompt or resume unfinished work.
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
