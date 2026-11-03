# Approvals

How a tool asks the user to approve something, and how a UI answers. `run_command` is the tool that asks ([@sheavly/coding](../../coding/docs/run-command.md)).

## The harness asks, the UI renders

The harness renders no prompt. A command that needs approval waits in an `ApprovalRegistry`
(`@sheavly/runtime/approvals/`; `createHarness` makes one, as `harness.approvals`, unless one is passed in), which emits typed
`ApprovalUpdate` events to its subscribers. The UI subscribes, shows each request its own way,
and answers with `respond`:

```ts
harness.approvals.subscribe((update) => {
  if (update.type === 'approval_requested') ui.show(update.request);
});
harness.approvals.respond({ id: request.id, response: { decision: 'approve' } });
```

| Update               | Carries                                                                             |
| -------------------- | ----------------------------------------------------------------------------------- |
| `approval_requested` | `request`: `id`, `callId`, `sessionId`, `tool`, `command`, `concerns`, `options`    |
| `approval_resolved`  | `id` and the `response`, once it's answered                                         |
| `approval_cancelled` | `id`: the waiting call was interrupted (its `signal` aborted) before an answer came |

`concerns` is `{ argument, reason }[]`; `options` is `['approve', 'skip', 'skip_with_message']`.
The tool waits (the run's other tools and the model stream carry on) until `respond` is called
with one of:

- `{ decision: 'approve' }`: the command runs as asked.
- `{ decision: 'skip' }`: the command doesn't run; the model gets an error result naming the
  arguments.
- `{ decision: 'skip_with_message', message }`: the command doesn't run, and the message is added
  to that result ("Instead, the user says: …"), so it steers the model's next step.

`respond` validates the answer with zod and throws for a malformed one or an id that isn't
waiting (an `ApprovalRequestError`); `pending()` lists open requests for a UI that connects late.
With no subscriber (a headless run, the demo, the workbook) those commands are refused right away
instead of waiting. A refused or skipped command fails the tool call with a `CommandRefusedError`
(`reason: 'needs_approval' | 'skipped'`), whose message is what the model reads.

A subscriber that throws doesn't stop the others: every listener still hears the update, then an
`ApprovalListenerError` reaches whoever caused it. On `approval_requested` the request fails
closed (the command doesn't run), unless a listener already answered it while hearing the
update, which stands; on `approval_resolved` the call still gets its answer and `respond`
throws; on `approval_cancelled` the call fails with that error.

These updates come from the registry, not the loop's event stream: a tool result waiting in that
ordered stream would hold back the request it waits for.
