# @sheavly/runtime

The stateful services a run uses, with nothing about files or code: the session tree and its
inboxes, background tasks, and approvals. `createHarness` (`@sheavly/host`) makes one of each per
run; tools and the loop share them.

```ts
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
```

| Module       | What it holds                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions/`  | `SessionRegistry`: the session tree, inboxes, the SSE `stream`, and one ordered stream of every session (`publish`, `subscribeEntries`), kept in memory or written to a store |
| `tasks/`     | `TaskRegistry`: background tasks a run waits for, checks on and cancels                                                                                                       |
| `approvals/` | `ApprovalRegistry`: requests a UI answers with `respond`                                                                                                                      |
| `errors/`    | `SessionError`, the approval errors, and `errorMessage` / `isMissingPath`                                                                                                     |
| `testing/`   | Fakes for tests: sessions, approvals, `startTaskTool`                                                                                                                         |

## Docs

- [Sessions](docs/sessions.md): the session tree, messages and steering, streaming to a UI.
- [Approvals](docs/approvals.md): how a tool asks the user, and how a UI answers.
