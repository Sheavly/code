# Scoped run services

`runServices({ harness, outputs, runSession })` (`run-services/run-services.helper.ts`) returns the
services every extension of a run can read without a `dependsOn`. The keys are in
`run-services/run-services.utils.ts`. Most are built **per extension** by a factory
(`hostServiceFor`, `@sheavly/extension`): the host calls it once, the first time an extension that
declared the service reads it, with the extension's name and sealed manifest. Each method of the
value it returns checks a **grant**, a `<noun>:<verb>` string in the extension's `sheavly.json`
`grants` list, and throws an `ExtensionUndeclaredError` naming the extension and the grant when it
is missing. The host reads `manifest.grants` once, when the service is built.

The types are in `@sheavly/runtime/sessions/session-scope.types`,
`@sheavly/runtime/tasks/task-scope.types` and `@sheavly/core/output/output.types`; the classes that
implement them are the `*.service.ts` files of `run-services/`.

**A grant limits what a service does for an extension; it is not a sandbox.** An extension is Node
code. It can use `fs`, `child_process` and `fetch` without declaring them, and a grant is only as
strong as the service behind it. Nothing reads `origin`: a built-in extension gets exactly what its
manifest declares, like a third-party one.

## The services

| Key (`run-services.utils`) | Name               | Grant (checked by)                                                                                                                                   | What it leaves out                                                                                                                                  |
| -------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_INFO`             | `session-info`     | `session:read`: `get`, `list`, `isReleased`, `releasedStarts`, `onLifecycle`                                                                         | message content, inboxes, every write, the registry                                                                                                 |
| `CHILD_SESSIONS`           | `child-sessions`   | `sub-agent:create`: `startChild`, `setModel`, `runChild`; `sub-agent:message`: `send`; `sub-agent:observe`: `onUpdate`; `sub-agent:report`: `report` | `publish*`, `end`, `idle`, `resume`, `release*`, `subscribeEntries`, `stream`, notices, inboxes, `'user'` as a sender, any session it did not start |
| `BACKGROUND_TASKS`         | `background-tasks` | `task:start`: `start`; `task:read`: `get`, `report`, `list`, `observe`; `task:cancel`: `cancel`, `group`                                             | other extensions' tasks, `cancelAll`, `cancelSession`, deliveries, `release*`                                                                       |
| `TASK_CONTROL`             | `task-control`     | `task:read-any`: `getOwned`, `list`, `report`; `task:cancel-any`: `cancel`, `group`                                                                  | `start`, `cancelAll`, `cancelSession`, deliveries, `release*`; every call needs a `sessionId`                                                       |
| `OUTPUT_READER`            | `output-reader`    | `output:read`: `log`, `read`, `search`                                                                                                               | `create`; absent when the app has no output store                                                                                                   |
| `OUTPUT_CAPTURE`           | `output-capture`   | `output:capture`: `create`                                                                                                                           | reading; absent when the app has no output store                                                                                                    |
| `MODEL`                    | `model`            | `model:call`: `stream` (`contextWindow` is forwarded live)                                                                                           | nothing else a provider has                                                                                                                         |
| `APPROVALS`                | `approvals`        | `approval:request`: `request` and the read-only `listening`                                                                                          | `respond`, `subscribe`, `observe`, `pending`, `screen`                                                                                              |
| `INSTRUCTIONS`             | `instructions`     | none: a constant                                                                                                                                     |                                                                                                                                                     |
| `MAIN_SESSION`             | `main-session`     | none: a constant                                                                                                                                     |                                                                                                                                                     |

An extension may only hold a grant of a service it reads (`services.requires` or `optional`): a
grant of an unread service, or one no service defines (a typo), fails its activation, as does any
other manifest mismatch.

## How the scopes hold together

- **Ownership.** `CHILD_SESSIONS` and `BACKGROUND_TASKS` remember the ids of what the extension
  started in a private set, so two extensions with the same grants own different things, and an
  id that is not yours behaves as an unknown one (a `SessionError` `unknown_session`, an
  `undefined` task, a `TaskError` `unknown_task` for a group). `TASK_CONTROL` owns nothing: the
  `sessionId` of each call is its scope, because the task tools act on every task of the calling
  session whatever started it. That `sessionId` is required, since the task registry reads an absent
  one as every task of the run. `SESSION_INFO` is not scoped to what you started: history search
  lists every session.
- **Sub-agents.** `startChild` needs a parent that is the main session or a child the extension
  owns, and refuses a `startedByCall` a sibling already used (`DuplicateChildCallError`). `send`
  comes from the main session or an owned child; the registry's ancestor rule still applies.
  `onUpdate` delivers an update only when its session is owned at that moment, so the update
  that announces a child's start, sent while it is being started, is not heard.
- **`runChild`.** It owns the call into the loop. `runServices` is given the loop's `runSession`
  and the scope builds `{ registry, ref: child }`, passes the run's full session and task
  registries to it, keeps the history as `keepHistory` is told, and cancels the child's own tasks
  (`cancelSession`) when the run ends, however it ends. The extension never holds a registry, the
  loop or a `RunSession`.
- **Tasks.** `start` needs the `sessionId` of an open session of the run (an ended or unknown one is
  refused), starts through `startWork`, and owns the id before any observer hears the start.
- **Switching off.** The host disarms every instance wherever it stops the extension's emitter
  (deactivate, a roll-back, a failed activation). After that every method throws a
  `ScopeDeactivatedError` naming the extension and the service, and what the scope had subscribed
  to is stopped. Scope objects are frozen.
- **Verbs reject, not throw.** A method that returns a promise (`cancel`, `runChild`, the output
  services) rejects with a refusal, as the output contract says, instead of throwing before it
  has a promise.

## Testing a scope

`@sheavly/host/testing/scope-run.fake` (`scopeRun`) builds a real harness with the services as an
app builds them and activates fake extensions with the grants you give: `servicesOf(name)` is
the view of the services that extension was handed. `noSubAgentRuns`
(`testing/run-loop.fake`) is the loop runner for a test that never runs a sub-agent.
