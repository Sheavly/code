# The provider contract

What a model backend implements (`@sheavly/core/provider/`). The built-in backends and how to add one are in [@sheavly/providers](../../providers/docs/backends.md).

## The request

A provider (`packages/core/src/provider/`) is one method, `stream(request)`, returning
`StreamEvent`s. Every model call gets a fresh `ProviderRequest`:

| Field          | What it is                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions` | System instructions for this call, or none: the run's `instructions` option, then what `beforeTurn` hooks added (e.g. AGENTS.md), joined with blank lines  |
| `messages`     | The conversation history (a copy): user, assistant and tool messages                                                                                       |
| `notices`      | An optional ordered array of typed `HarnessNotice` values: transient harness data sent after history, never part of it                                     |
| `temperature`  | An optional sampling hint for repeatable work (a summary). An adapter sends it only where its API accepts it with the call's other settings, else omits it |
| `tools`        | The tool definitions (name, description, JSON schema)                                                                                                      |
| `signal`       | Aborts the call                                                                                                                                            |

`instructions` are rebuilt each turn and never stored in `messages`, so they can change between
turns (an edited AGENTS.md) without touching history. The Responses client sends them as the
API's `instructions` field.

## Harness notices

`HarnessNotice` (`@sheavly/protocol/notice/notice.types`) separates transient harness data from user
input and standing instructions. Its first kind, `context-usage`, carries validated context
counts with at least one of `window` or `used` known. Unknown counts are omitted, not zero.

`output-continuation` carries the recovery `attempt` and an optional explicitly configured
`maxAttempts`. Its formatter asks the model to finish the original task without repeating completed
text or tool actions, and without acknowledging the notice or cutoff. Multiple notices can coexist
on a request, so recovery does not replace context telemetry.
Provider implementations consume `request.notices` as an ordered array, rather than a single
`request.notice`; model and UI payloads still use the same `HarnessNotice` type.

Providers use `formatHarnessNotice` (`@sheavly/core/notice/notice.utils`) for consistent wording:
an explicit `<harness-notice kind="context-usage">` envelope identifies telemetry as not a user
message or request and tells the model to use it silently unless context limits affect the task.
The formatter owns this handling policy; callers supply data, not free-form instructions.
Its static wording lives in the internal `notice/notice.constants.ts`; the formatter inserts
the current context measurement without changing the policy text.
The loop emits the same data as a `harness_notice` event before the model call. UIs receive it
through the ordinary session stream without provider imports, text parsing or a special route.
They decide whether and how to render it; model-facing wording and UI presentation stay separate.

`notices` are not history, so an adapter appends their formatted text after it has built the history.
The API may require a user-role message; the envelope distinguishes its actual origin. Each
turn's notice is gone from the next request, which matters to replay state bound to
what a call sent: Anthropic binds a thinking signature to everything before the reply, the notice
included, and refuses the block (400) once that content is missing. Its adapter therefore treats
the notice as part of the reply's prefix and drops that thinking on the next turn, instead of
replaying it. Responses and Chat Completions have no such binding.

## The context window

A provider may expose `contextWindow`, the size of its model's context in tokens. The loop reads
it before each model call, so a provider that can change model answers for the one its next call
goes to. A provider that doesn't know it leaves it out, and the run goes on without it.
