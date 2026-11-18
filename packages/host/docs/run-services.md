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
  owns. `send` comes from the main session or an owned child; the registry's ancestor rule still
  applies. `onUpdate` delivers an update only when its session is owned at that moment, so the
  update that announces a child's start, sent while it is being started, is not heard. A
  message to a session the extension did not start reads as `Unknown session`, whoever started it.
- **Frozen copies.** The scope keeps its own frozen record of each child and returns a different
  frozen copy, so changing the returned ref (to name another session, say) throws and cannot
  redirect `runChild`, which builds what the loop receives from the scope's record. The
  `main-session` service is a frozen copy of the harness's own object, and the scope objects are
  frozen too. The `SessionInfo` and `TaskInfo` the services return are detached copies of the
  registry's state, so changing one changes nothing in the run; they are not frozen.
- **`runChild`.** It owns the call into the loop. `runServices` is given the loop's `runSession`
  and the scope builds `{ registry, ref: child }`, passes the run's full session and task
  registries to it, keeps the history as `keepHistory` is told, and cancels the child's own tasks
  (`cancelSession`) when the run ends, however it ends. The extension never holds a registry, the
  loop or a `RunSession`. It refuses a child that is not owned, that has ended, or whose run has
  not returned yet (`ChildRunningError`; the flag clears however the run ends). `onRunEnd` is
  called when the loop has returned, before the cancel, so a caller can stop listening first; the
  cancel runs even if `onRunEnd` throws, and when the run and `onRunEnd` both fail, the run's
  error is the one thrown.
- **Tasks.** `start` needs the `sessionId` of an open session of the run (an ended or unknown one is
  refused) and starts through `startWork`. A task is owned by the id its own `start` returned:
  what the registry announces during the call is held until then, so a task another scope starts
  meanwhile is never claimed. Events reach `observe` in the order heard, through a queue: an
  observer that throws never stops `start`, the other observers or the events after it (its error
  is rethrown on its own, as a registry listener's is), and what a nested `start` announces is
  delivered after the events already queued.
- **Skipped extensions.** The scope of a service is built when the host checks that an extension's
  required services are readable, so one is also built for an extension that is then skipped
  (untrusted, dependency, service); the host disarms it then, like any other stop.
- **Approvals.** The scope builds the request from `callId`, `sessionId`, `command`, `concerns` and
  `signal` only: `tool` is `extension:<name>`, the `command` the user reads is prefixed with
  `[<name>]`, only the default options are offered (no `always_allow`, no `allow_session`) and
  there is no `keeps`, so an answer applies once and never becomes an allow rule. `concerns` is
  rebuilt as `{ argument, reason }` strings: a non-array is none, an entry without two string
  fields is dropped (nothing becomes the text `undefined`), at most 20 are kept and each string is
  cut to 500 characters; `command` is not bounded here. The `[<name>]` prefix is a
  label, not an unforgeable attribution: the caller's text follows it and may contain newlines
  (a terminal shows control characters as literals), so a screener should trust `tool`. A
  `sessionId` may be any open session of the run, not only one the extension started. `coding` asks through `harness.approvals` directly, not
  through this scope.
- **Switching off.** The host disarms every instance before the extension's own `deactivate` runs,
  wherever it stops the extension's emitter (deactivate, a roll-back, a failed activation). After
  that every method throws a `ScopeDeactivatedError` naming the extension and the service, and
  what the scope had subscribed to is stopped. It does not abort a `runChild` already in flight
  nor cancel the tasks the scope started.
- **What the scopes do not hand out.** No scoped service hands out `publish`, `queueNotice` or
  `publishTask`. They are not silent: `send` and `report` produce session updates, and a child's
  loop publishes its events.
- **`output:read`** reads the complete output of every command of the run, which can hold secrets;
  grant it as you would the right to read those commands.
- **`task:*-any`.** `TASK_CONTROL` cannot know which session is calling: the `-any` verbs trust
  the `sessionId` passed (agents' tools pass the calling one), so an extension with
  `task:read-any` or `task:cancel-any` can name any session of the run.
- **`sub-agents`** is provided by `agents`, not by the host, and write-only: `share` copies the
  arrays and validates each entry (an object with a non-empty string `name`; no duplicate, no name
  a sub-agent already gets), but does not freeze the tool and hook objects, which are held by
  reference. Nothing can read the shared lists. **Known gap, since the service was introduced:**
  `share` is gated only by `requires: sub-agents` and cannot check the sharer's manifest `tools` and
  `hooks`, because the service is provided by an extension and only host services define grants in
  this version. The intended fix is a grant, once extension-provided services can define grants.
- **Verbs reject, not throw.** A method that returns a promise (`cancel`, `runChild`, the output
  services) rejects with a refusal, as the output contract says, instead of throwing before it
  has a promise.

## Testing a scope

`@sheavly/host/testing/scope-run.fake` (`scopeRun`) builds a real harness with the services as an
app builds them and activates fake extensions with the grants you give: `servicesOf(name)` is
the view of the services that extension was handed. `noSubAgentRuns`
(`testing/run-loop.fake`) is the loop runner for a test that never runs a sub-agent.
