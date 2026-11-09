# The provider contract

What a model backend implements (`@sheavly/core/provider/`). The built-in backends and how to add one are in [@sheavly/providers](../../providers/docs/backends.md).

## The request

A provider (`packages/core/src/provider/`) is one method, `stream(request)`, returning
`StreamEvent`s. Every model call gets a fresh `ProviderRequest`:

| Field          | What it is                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions` | System instructions for this call, or none: the run's `instructions` option, then what `beforeTurn` hooks added (e.g. AGENTS.md), joined with blank lines |
| `messages`     | The conversation history (a copy): user, assistant and tool messages                                                                                      |
| `notice`       | A typed `HarnessNotice`, or none: transient harness data sent after history, never part of it                                                             |
| `tools`        | The tool definitions (name, description, JSON schema)                                                                                                     |
| `signal`       | Aborts the call                                                                                                                                           |

`instructions` are rebuilt each turn and never stored in `messages`, so they can change between
turns (an edited AGENTS.md) without touching history. The Responses client sends them as the
API's `instructions` field.

## Harness notices

`HarnessNotice` (`@sheavly/core/notice/notice.types`) separates transient harness data from user
input and standing instructions. Its first kind, `context-usage`, carries validated context
counts with at least one of `window` or `used` known. Unknown counts are omitted, not zero.

Providers use `formatHarnessNotice` (`@sheavly/core/notice/notice.utils`) for consistent wording:
an explicit `<harness-notice kind="context-usage">` envelope identifies telemetry as not a user
message or request and tells the model to use it silently unless context limits affect the task.
The formatter owns this handling policy; callers supply data, not free-form instructions.
UI status bars render their own usage data, independently of model-facing notices.

`notice` is not history, so an adapter appends the formatted text after it has built the history.
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
