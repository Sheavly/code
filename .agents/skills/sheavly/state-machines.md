# State machines

Most of the harness's lifecycles are state machines nobody wrote down: a boolean, an optional field, map membership or "what history says". This is the catalogue of them as they are, the invariants each must keep, and the rule for adding one. Where the code has more than one vocabulary for one fact, that is stated as a divergence to remove, never as the design.

## How to treat a state machine

1. One table of states and transitions, in the module that owns it. Every other reader asks that module.
2. States that cannot coexist are a union, not several optional fields.
3. A terminal state is reached once. Cleanup runs on every path into it.
4. A test lists the transitions and the ones that must be refused.
5. A new kind of the same thing (a background-work kind, a notice kind) joins the existing machine; it does not get its own.

## The flow that must hold

The owner's model of how work flows. Tests state these as rules.

- The main session ends its turn when the model finishes, even while background commands or sub-agents run.
- Only `await_tasks` keeps the main session open: it stays open until the grouped tasks settle or the user stops it.
- A line queued while the session is held on `await_tasks` stays queued until the model has finished. Otherwise a queued line starts as the next prompt once the model finishes its turn.
- Finished work reaches the model once, at its next model call, as a notice. Notices the model must remember are stored in history; transient ones (`context-usage`) ride one call and are never stored.
- Services never hold a run open; only finite work can be awaited.
- A sub-agent reports its own status and the parent can steer it; depth is bounded (`MAX_SESSION_DEPTH`).
- A stopped run leaves history valid: every tool call has a result, even a placeholder.

## Catalogue

| Machine                       | Where its state lives                                                                    | Known divergence or gap                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Run                           | `packages/loop/src/stream-agent/stream-agent.helper.ts` (`reason`, the `done` event)     | no state variable: "over" means a `done` arrived; the initial `reason` is `max_turns`                              |
| Turn                          | `packages/loop/src/stream-agent/turn.helper.ts` (`runTurn`, `finishTurn`)                | an implicit sequence of awaits and early returns                                                                   |
| End of run, as data           | `TurnStopReason`, `StopReason`, `DoneReason`, `SessionState`, `RunOutcome`, `TaskStatus` | six vocabularies for one fact                                                                                      |
| Tool call                     | `packages/loop/src/stream-agent/sample.helper.ts` (`settled`, the abort placeholder)     | state in an optional field and a race                                                                              |
| Event queue                   | `packages/loop/src/queue/queue.service.ts`                                               | flags and counters (`closed`, `failure`, `consumerGone`)                                                           |
| Session                       | `packages/runtime/src/sessions/sessions.service.ts`                                      | `state`, `lastOutcome` and `endedAt` can disagree                                                                  |
| Background task               | `packages/runtime/src/tasks/tasks.service.ts`                                            | `cancelled` is read from `signal.aborted` at settle time; `silent`, `delivered`, `#ready` together mean "notified" |
| Background work, as a concept | `run_command` (`backgroundKind` from model input) and the sub-agent tool                 | one task registry per sub-agent; completion policy set at the call site; nothing releases finished work            |
| Notices                       | `packages/runtime/src/tasks`, the loop's delivery helpers                                | lifetime (transient or persistent) decided at each call site                                                       |
| Approval                      | `packages/runtime/src/approvals`, the terminal's prompt, the permission store            | state spread over a function, an app class and a disk store                                                        |
| Conversation "running"        | `packages/host/src/conversation/conversation.helper.ts`, `conversations.service.ts`      | tracked in three places                                                                                            |
| Persistence                   | `packages/host/src/conversation/` keeper, `packages/storage/src/conversation-store/`     | a failed write is sticky; writes across files are not transactional                                                |
| Provider switch               | `packages/providers/src/switch/`                                                         | lazy active name, no `remove`                                                                                      |
| File access                   | `packages/workspace/src/file-locks`, `file-reads`                                        | `FileReads` is not invalidated by `run_command`                                                                    |
| Trust                         | `packages/workspace/src/trust/`                                                          | checked once at load; `confineImports` is process-global                                                           |
| Instruction context           | `packages/workspace/src/instruction-context/` and its four hooks                         | state is read back out of history                                                                                  |
| Chat input                    | `apps/terminal/src/chat/chat-session.service.ts`, `chat-queue.service.ts`                | a stopped prompt is reported `completed`                                                                           |
| Workbook run                  | `apps/terminal/src/workbook/` run folder                                                 | unfinished means `result.json` is missing; the `last` pointer moves before the run can fail                        |
| Dev hooks                     | `~/.cache/sheavly-harness/chats/<chat-id>.json`, `.git/cursor-docs-nudged.json`          | no schema, cleanup or locking                                                                                      |

This table is the starting inventory, read from the code. When you fix a divergence, update its row in the same change; when you add a machine, add a row.

## Adding or changing one

- Find its row. If it exists, change the machine, not a caller.
- If the fact you need is already encoded another way, derive the new form from the owner instead of adding a vocabulary.
- Say in the PR whether the change moves a transition (a behaviour change) or only restructures.
- Add the transition test before the change when the machine had none.
