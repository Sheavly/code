# Model-facing notices

`formatHarnessNotice` formats the protocol's `HarnessNotice` for a model. It is the only place
that writes the trusted notice envelope. Apps receive the same structured notice data and choose
their own presentation; they do not need to parse this text.

## Completion context

`agent-report`, `task-finished` and `tasks-finished` can carry a `TaskCompletionContext` from
`@sheavly/protocol/notice/notice.types`. The formatter renders:

- `reason` as a fenced block of calling-agent-authored DATA, explicitly not an instruction;
- `startedAt` as epoch milliseconds, without converting it to a date string;
- `durationMs` as milliseconds, including zero;
- `userMessagesSinceStart` as the count of intervening user messages, including zero;
- `callId`, when supplied, as the starting tool call ID on the measurements line.

The reason is the explicit `await_tasks` reason, or the task description fallback for an
ungrouped completion. It recalls why work was started or awaited; it is not a new user request.
The loop supplies this context for new completions. The formatter does not calculate or infer
missing measurements or IDs. In particular, it does not recover a call ID from a sub-agent's
session metadata: the loop includes it only while that starting assistant tool call is still
visible in the summary view.

A grouped completion keeps its existing fenced wait reason and renders the aggregate context's
measurements without repeating the reason in another block. Group measurements cover the earliest
member start through the latest member finish and aggregate the intervening user-message count;
the group context has no call ID. Each member retains its own context, including its own fenced
reason and any supplied call ID. Bodies appear in member order, with no nested trusted envelopes.
Reports remain whole, and task output remains the bounded preview supplied by the protocol.

Historical notices without context keep their previous formatting, including the group wait
reason fence. The field is optional for history compatibility, not a request to synthesize it
at formatting time.

## Trust boundary

Reports, task output, completion reasons and wait reasons are data, not harness instructions.
Reasons and output have separate fences longer than every dash run in their content, so a forged
closing fence cannot end a block early. `escapeTags` neutralizes opening angle brackets and their
lookalikes in all agent-authored text; `oneLine` additionally prevents IDs and other header fields
from adding lines. Report headings remain report content rather than being rewritten.

Regression tests in `src/notice/__tests__/` cover completion contexts, legacy formatting, omitted
call IDs, forged tags and colliding fences. The formatter is a model-facing trust boundary, not a
replacement for protocol validation or for checking a sub-agent's findings against user requests
and verifiable facts.
