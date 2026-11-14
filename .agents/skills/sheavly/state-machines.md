# State machines

Most of the harness's lifecycles are state machines nobody wrote down: a boolean, an optional field, map membership or "what history says". This is the catalogue of them as they are, the invariants each must keep, and the rule for adding one. Where the code has more than one vocabulary for one fact, that is stated as a divergence to remove, never as the design.

## How to treat a state machine

1. One table of states and transitions, in the module that owns it. Every other reader asks that module.
2. States that cannot coexist are a union, not several optional fields.
3. A terminal state is reached once. Cleanup runs on every path into it.
4. A test lists the transitions and the ones that must be refused.
5. A new kind of the same thing (a background-work kind, a notice kind) joins the existing machine; it does not get its own.

## The flow that must hold

The owner's model of how work flows. Tests state these as rules: every rule has tests whose titles start with its number ("rule 3: …").

1. The main session ends its turn when the model finishes, even while background commands or sub-agents run. When finite work finishes while the session is idle, the conversation starts a run on its own to deliver the notice (`wake` in `createConversation`); its events reach every UI through the combined stream. A sub-agent is the exception: its loop does not end while its own finite work runs (`holdOpenFor`).
2. Only `await_tasks` keeps the main session open: it stays open until the grouped tasks settle or the user stops it.
3. A line queued while the session is held on `await_tasks` stays queued until the model has finished.
4. Otherwise a queued line starts as the next prompt once the model finishes its turn.
5. Finished work reaches the model once, at its next model call, as a notice. Notices the model must remember are stored in history; transient ones (`context-usage`) ride one call and are never stored.
6. Services never hold a run open; only finite work can be awaited.
7. A sub-agent reports its own status and the parent can steer it; depth is bounded (`MAX_SESSION_DEPTH`).
8. A stopped run leaves history valid: every tool call has a result, even a placeholder.

### Where the code differs from these rules

The tests run through the real loop and conversation and are parameterised by kind (foreground tool, background command as `task` and as `service`, sub-agent). A test that states a rule today's code breaks is marked `it.fails`, so it turns red when the code is fixed and the fixing change must update it. Where a test titled "pinned today" sits beside it (rule 7, a stop while a prompt is prepared, and a stale file read), it holds today's behaviour and proves the setup works; the other defects have the `it.fails` test only.

- **Rule 7:** a steering message from the inbox enters history without an `id`, and the user-messages summary section drops it.
- **Stop while a prompt is prepared:** `Conversations.stop` only reaches a prompt that is past `preparePrompt`, so an earlier stop is ignored and the prompt runs to its end.
- **Outside the flow rules:** `FileReads` is not invalidated by `run_command`, so `edit_file` accepts a stale read; the backend gives the AGENTS.md hook only the workspace root, so a moved working root keeps the main checkout's file.

A change to any of these is a behaviour change: it lands as its own change, flips the matching test, and updates this section.

Rule 5 holds at the group boundary: `group()` throws `TaskError` (`task_delivered`) for a task whose notice was already delivered, and `await_tasks` shows the model that error as an error result. A task cancelled on request is silent and was never notified, so it can be grouped until the next model step releases it (a cancel and a group in one response both work). `groupMemberError` checks ownership before anything else about the task, so a foreign task's group, kind or delivery is never revealed.

A task's outcome is what its run reported. `TaskRegistry` records `completed` when the run resolved with exit code 0, even if a cancel aborted its signal before the settle ran: the registry cannot see whether the resolve or the abort came first, only the result. Any other end after an abort (no exit code, a failure code, a rejection) is `cancelled`. This is the same for every work kind. `cancel()` still marks the task silent, so a task cancelled after it finished returns `completed` to the caller and sends no notice; a grouped member stays in its group and reports its own status. A run that ignores the abort and then succeeds is recorded as `completed`. So that a cancel is never read as success, `runScript` returns no exit code (`null`) for a pipeline whose caller signal aborted while it ran, even when its last command had already exited 0. The report of a task that finished before its cancel is not delivered: it is only in what `cancel()` returns, which `cancelAll`, `cancelSession` and a sub-agent's shutdown discard.

Finished work is released, not kept for the life of the process. Before each model call (once per model step, not once per prompt), after the notices are built and in history, `reportFinishedTasks` calls `TaskRegistry.releaseFinished(sessionId)`: delivered tasks and silent settled tasks the session owns (or that have no owner) are forgotten, and a held group member stays until its group is delivered. A released id is unknown to `get`, `report`, `byCallId` and `list`; `isReleased(id)` tells it from an id that never existed (ids are sequential and never reused), so `group()` throws `task_released`, and `task_status` and `cancel_task` say the task was already reported and released. The notice in history carries the task's snapshot and report, so nothing reads the registry again. Main-run shutdown releases nothing.

A delivered sub-agent's session is released in the same step, after the task release: for each delivered task that started a sub-agent (found by its call id), whatever its outcome, so a failed or stopped sub-agent with no report goes too, `reportFinishedTasks` calls `SessionRegistry.releaseAgent(id)` (`finishedTaskNotice` finds the sub-agent by its session, so the session can only go after the notice). A task cancelled silently never delivers, so its session stays. It releases the ended sub-agent and every session under it and announces each as `session_released`. It returns false instead of throwing, and does not retry, when a session in the subtree is still open, for a main session, and for an id already gone. The main session is never released: `Conversations`, resume and the HTTP routes read it after `close()`, and the registries are dropped with the conversation. A released id is unknown to `get`, `list`, `children` and the `stream` catch-up; `isReleased(id)` tells it from one that never existed, and `publish`, `publishTask`, `setModel`, `report` and `send` throw `session_released`. The registry keeps only the released id, its parent and its start time, so a subtree filter still matches the entries a released sub-agent left in the combined stream, which stay. Its stored history stays readable: the history tools search `releasedStarts()` too, all sessions in start order so a cursor survives a release. `message_agent` says the sub-agent was released. Release is in-process only: a reopened conversation restores every stored session.

## Catalogue

| Machine                       | Where its state lives                                                                    | Known divergence or gap                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Run                           | `packages/loop/src/stream-agent/stream-agent.helper.ts` (`reason`, the `done` event)     | no state variable: "over" means a `done` arrived; the initial `reason` is `max_turns`                                                 |
| Turn                          | `packages/loop/src/stream-agent/turn.helper.ts` (`runTurn`, `finishTurn`)                | an implicit sequence of awaits and early returns                                                                                      |
| End of run, as data           | `TurnStopReason`, `StopReason`, `DoneReason`, `SessionState`, `RunOutcome`, `TaskStatus` | six vocabularies for one fact                                                                                                         |
| Tool call                     | `packages/loop/src/stream-agent/sample.helper.ts` (`settled`, the abort placeholder)     | state in an optional field and a race                                                                                                 |
| Event queue                   | `packages/loop/src/queue/queue.service.ts`                                               | flags and counters (`closed`, `failure`, `consumerGone`)                                                                              |
| Session                       | `packages/runtime/src/sessions/sessions.service.ts`                                      | `state`, `lastOutcome` and `endedAt` can disagree                                                                                     |
| Background task               | `packages/runtime/src/tasks/tasks.service.ts`                                            | a run that reports exit code 0 is `completed` even if aborted; `silent`, `delivery`, `group`, `#ready` mean "notified"                |
| Background work, as a concept | `run_command` (`backgroundKind` from model input) and the sub-agent tool                 | one task registry per sub-agent; completion policy set at the call site; finished tasks and delivered sub-agent sessions are released |
| Notices                       | `packages/runtime/src/tasks`, the loop's delivery helpers                                | lifetime (transient or persistent) decided at each call site                                                                          |
| Approval                      | `packages/runtime/src/approvals`, the terminal's prompt, the permission store            | state spread over a function, an app class and a disk store                                                                           |
| Conversation "running"        | `packages/host/src/conversation/conversation.helper.ts`, `conversations.service.ts`      | tracked in three places                                                                                                               |
| Persistence                   | `packages/host/src/conversation/` keeper, `packages/storage/src/conversation-store/`     | a failed write is sticky; writes across files are not transactional                                                                   |
| Provider switch               | `packages/providers/src/switch/`                                                         | lazy active name, no `remove`                                                                                                         |
| File access                   | `packages/workspace/src/file-locks`, `file-reads`                                        | `FileReads` is not invalidated by `run_command`                                                                                       |
| Trust                         | `packages/workspace/src/trust/`                                                          | checked once at load; `confineImports` is process-global                                                                              |
| Instruction context           | `packages/workspace/src/instruction-context/` and its four hooks                         | state is read back out of history                                                                                                     |
| Chat input                    | `apps/terminal/src/chat/chat-session.service.ts`, `chat-queue.service.ts`                | a stopped prompt is reported `completed`                                                                                              |
| Workbook run                  | `apps/terminal/src/workbook/` run folder                                                 | unfinished means `result.json` is missing; the `last` pointer moves before the run can fail                                           |
| Dev hooks                     | `~/.cache/sheavly-harness/chats/<chat-id>.json`, `.git/cursor-docs-nudged.json`          | no schema, cleanup or locking                                                                                                         |

This table is the starting inventory, read from the code. When you fix a divergence, update its row in the same change; when you add a machine, add a row.

## Adding or changing one

- Find its row. If it exists, change the machine, not a caller.
- If the fact you need is already encoded another way, derive the new form from the owner instead of adding a vocabulary.
- Say in the PR whether the change moves a transition (a behaviour change) or only restructures.
- Add the transition test before the change when the machine had none.
