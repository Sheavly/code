# Sessions and background work

How background work (a command, a service, a sub-agent) is started, owned, read and ended, and which parts are enforced. [state-machines.md](state-machines.md) holds the lifecycles and the flow rules; [extending.md](extending.md) holds the steps for a new kind. This guide states what is true today. Where the code falls short of the goal, it is listed under "Gaps", never described as done.

## One system

A run has one `TaskRegistry` (`packages/runtime/src/tasks/tasks.service.ts`), shared by the main session and every sub-agent. Task ids (`t1`, `t2`, …) are unique in the run. A session sees a task through ownership: the task records the `sessionId` of the tool call that started it.

## Starting work: kinds

- Work is a `WorkDefinition` (`packages/runtime/src/tasks/work.types.ts`): a `WorkInput` plus a `backgroundKind`, `task` (finite: it can be grouped, awaited and held for) or `service` (never awaited, may outlive the run).
- A kind is a factory that builds the definition and fixes the policy after spreading the input, so an input cannot override it: `finiteWork` and `serviceWork` (`packages/runtime/src/tasks/work.utils.ts`), `subAgentWork` (`packages/tools/src/sub-agent/sub-agent-work.utils.ts`), `commandTaskWork` and `commandServiceWork` (`packages/coding/src/run-command/command-work.utils.ts`).
- The tool, not the model, picks the kind: `run_command` with `background: true` always starts `commandTaskWork`, and `start_service` always starts `commandServiceWork`. Neither has a `backgroundKind` input, and both share the steps before a command starts (`packages/coding/src/run-command/command-launch.helper.ts`). A new command kind is a new tool over the same helper. **Review-only:** that a tool names the right factory; `packages/coding/src/run-command/__tests__/start-service.tool.test.ts` and `packages/coding/src/run-command/__tests__/background.tool.test.ts` pin the two policies.
- `startWork({ tasks, work })` is the only place that calls `TaskRegistry.start`. **Enforced** by `harness/no-direct-task-start` (type-aware: it keys on the receiver being a `TaskRegistry`, so an alias, destructuring, `.call`, a string key or a re-export still fails). Tests and fakes are exempt by file kind, since they drive the registry directly. A new kind never needs the exemption: it is a factory that builds a `WorkDefinition`, so an extension adds a kind without touching the registry.
- What the rule cannot see: a registry typed `any` or cast to another shape, a registry assigned to a structural type that re-declares `start` (an interface or `{ start(...) }`), and `Reflect.get(tasks, 'start')`. Review carries those. `TaskRegistry.start` stays public, so the type system does not back the rule; making it non-public would, and is its own change.

## Ownership and reads

- `list(sessionId?)`, `getOwned`, `byCallId({ callId, sessionId })`, `group` and `cancelSession` are scoped: a task another session owns reads as unknown.
- `task_status`, `cancel_task` and `await_tasks` read as the calling session (`context.session?.id`) and refuse a call with no session. An unknown, foreign or released id gets the same answer from all three: `task_status` and `cancel_task` throw `missingTaskMessage` as a tool error, and `group()` throws it as a `TaskError` with reason `unknown_task` (`packages/runtime/src/tasks/tasks.utils.ts`), so no tool tells another session's task from one that never existed.
- Work started through a kind always has an owner: `sessionId` is required in `WorkInput`, and `run_command` with `background: true` and `start_service` refuse a call with no session before asking for approval (`requireBackground`, `packages/coding/src/run-command/command-launch.helper.ts`). **The type is the guard:** it cannot see a direct `TaskRegistry.start`, which still takes an optional owner (tests use it), so an ownerless task is still possible there and `harness/no-direct-task-start` is what keeps source off it.
- **Review-only:** that a tool passes the caller's own session. The unscoped methods (`cancelAll`, `list()`, `runningCount`, `takeUnreported`, `hasUnreported`) are legitimate for the host's shutdown; a rule cannot tell that from a tool's unscoped call without keying on argument presence, which is brittle. Tests cover the behaviour (`packages/runtime/src/tasks/__tests__/scoped-reads.test.ts`, `packages/tools/src/tasks/__tests__/scoped-tools.test.ts`).

## Shutdown

- A sub-agent ends with `tasks.cancelSession(child.id)` (`packages/tools/src/sub-agent/sub-agent.tool.ts`); the loop's abort cancels its own session's tasks (`packages/loop/src/stream-agent/stream-agent.helper.ts`), never the registry's.
- `cancelAll` is the main run's shutdown, called by the host.
- Delivered tasks and their ended sub-agent sessions are released: see "Finished work is released" in [state-machines.md](state-machines.md).

## Gaps

Stated as they are, each its own change:

- A finished task is announced twice on the wire: `task_completed` (a loop `AgentEvent`, at delivery) and `task_ended` (a runtime task update, when it settles). Only one notice is stored.
- `TaskRegistry.start` still accepts no owner, and `cancelSession` matches exact ownership, so a task started that way (only a test can, since `startWork` requires one) is stopped only by `cancelAll`.
- `nextSettled` wakes on any session's settlement: a spurious wake only, since the loop re-checks `hasPendingTasks(id)`.
