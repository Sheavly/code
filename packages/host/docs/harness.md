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

| Services                                  | For                                                                  | What it makes                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `createHarness` (`@sheavly/host`)         | Any LLM project: text parsing and extraction, chat wrappers, no repo | The session, task and approval registries a run shares, around the provider the UI picked. Opens no workspace and reads no file       |
| `createCodingHarness` (`@sheavly/coding`) | A coding agent in a repo                                             | `createHarness`'s services, plus the opened `Workspace`, one `KeyedLocks` and one `ProcessRunner` built from the env the UI passes in |

The UI builds its tools and hooks on those: `createTaskTools(tasks)`, `createSubAgentTool({ … })`
and `createMessageAgentTool` (`@sheavly/tools`); a coding UI's `createReadFileTool({ workspace })`,
`createRunCommandTool({ processes, … })` and the rest (`@sheavly/coding`); `agentsMdSource` (built with
`createInstructionHook` from `@sheavly/core`) and, if it trusts the workspace, `loadProjectHooks` (`@sheavly/workspace`). The backend does it in
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

## Run services for extensions

A UI that composes its run from extensions (`@sheavly/extension`) hands the harness's state to all
of them the same way: `runServices({ harness, outputs })` (`run-services/`) returns it as
`hostService` entries for `ExtensionHostOptions.services`. Every extension then reads it in
`activate` without a `dependsOn`, a built-in one no differently from a third-party one.

| Key (`run-services.utils`) | Value                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| `PROVIDER`                 | `harness.provider`                                                   |
| `INSTRUCTIONS`             | `harness.instructions`, the composed base instructions               |
| `SESSIONS`, `MAIN_SESSION` | `harness.sessions` and `harness.mainSession`                         |
| `TASKS`                    | `harness.tasks`                                                      |
| `APPROVALS`                | A request-only view of `harness.approvals` (`ApprovalRequester`)     |
| `OUTPUTS`                  | The app's `OutputStore`; left out when the app has none (use `find`) |

The values are the harness's own objects, not copies, so work an extension starts through `TASKS`
is the run's work; `APPROVALS` is the exception: an object with only `request`, so an extension
can ask the user (in its own words) but cannot answer an approval. It does not hide approvals:
they still appear in the sessions' stream that `SESSIONS` exposes. There is no environment
service: an extension's configuration comes through its settings (declared in its manifest,
`ExtensionHostOptions.settings`).

**Run services are not a sandbox.** An extension is code that can already do whatever Node can;
the services add the run's authority. `TASKS` lets it list, read the output of, cancel and release
the run's other tasks (it starts only work it executes itself, never a process for you);
`OUTPUTS` reads and searches the complete output of every command, which can hold secrets;
`PROVIDER` makes model calls with the app's credentials; `SESSIONS` reads every session's events
and approvals, sends messages into a session as if from the user, ends sessions and publishes
entries into the combined stream. The app decides which services it supplies (`runServices`
returns a list it can filter) and which extensions it loads; the host's only policy is the
`origin: 'project'` trust gate (anything that is not `builtin` goes through it). `origin` is
declared by whatever loads the extension, not by the extension: a loader for repo code (#332)
must set `origin: 'project'` itself and should supply narrowed services.

## Instruction composition

`createHarness` returns stable `instructions` assembled by `composeInstructions`:
generic core from `instructions/instructions.prompt.ts`, then host extras. Set `baseInstructions` to replace just the generic core;
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

The core also prefers dedicated tools for file work and requires reading relevant files before
editing. Delegation guidance covers which work to split, not how to call a particular tool.
Tool descriptions continue to own their parameters, limits and execution mechanics.

Git/GitHub policy is conditional on the task: commits require an explicit request, preceded by
status, diff and history inspection, intended-file staging and result verification. Configuration
changes and hook bypasses are forbidden; destructive operations and history rewrites require
explicit authorization. PR preparation inspects the full branch against its intended base,
including remote tracking. Use `gh` when available, but editing or committing never implies
permission to publish or change issues. The text contains no repository-specific branch, label,
commit-message or merge conventions. The hook-bypass prohibition governs agent requests; it does
not guarantee repository hooks run. The coding command runner independently disables repository
hooks through its existing safety environment, which prompt wording does not change.

The backend passes its composed shared text to the child factory; the child adds its role,
then any child-specific extras. Other hosts explicitly choose what children receive. Parent
conversation overrides and history are not implicitly inherited. All models use the same text,
including unknown families and pinned children; switching providers does not rebuild it.

The default's adjacent `@system-prompt-review` comment is development metadata, not model-facing
text. `harness/system-prompt-review` checks the reviewed production prompt/tool sources and the
base prompt's own hash plus an explicit decision and reason; `npm run lint:prompt` runs it across
workspace boundaries. This is
an offline review gate, not proof of semantic freshness or model compliance. Its watched-source
scope and limitations are documented in [the rule](../../eslint-config/docs/rules.md#system-prompt-review).
Custom bases and conversation overrides remain host choices; the record does not restrict them.

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
  Text is never delivered to a running prompt. `conversation.yieldPrompt()` (and
  `conversations.yieldPrompt(id)`) instead asks it to end as `completed` at its next completion
  point, without waiting for finite tasks or sub-agents, which keep running; their results are
  delivered to the next prompt. It returns `false` for an idle or stopping prompt, and closed
  conversations throw `session_ended`. A UI keeps what the user types queued, outside history, and
  sends it with `send` once the prompt ends.
- The history is written when a prompt starts (previous finished history plus this prompt) and
  when it ends or fails, as for any prompt. In-flight model/tool work remains in the separately
  persisted stream; it joins the history snapshot when the run ends or fails.
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
(`workspace`, `process`, `trust`, `project-hooks`, `agents-md`) or the coding tools
(`read-file`, `write-file`, `edit-file`, `files`, `run-command`), and neither do their tests. Only
a coding UI reaches them, which is why each lives in a package of its own and the generic ones
never depend on the coding ones.
