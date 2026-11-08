# The provider contract

What a model backend implements (`@sheavly/core/provider/`). The built-in backends and how to add one are in [@sheavly/providers](../../providers/docs/backends.md).

## The request

A provider (`packages/core/src/provider/`) is one method, `stream(request)`, returning
`StreamEvent`s. Every model call gets a fresh `ProviderRequest`:

| Field          | What it is                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions` | System instructions for this call, or none: the run's `instructions` option, then what `beforeTurn` hooks added (e.g. AGENTS.md), joined with blank lines |
| `messages`     | The conversation history (a copy): user, assistant and tool messages                                                                                      |
| `notice`       | One short line that changes every call (the context line), or none: sent after the history, never part of it                                              |
| `tools`        | The tool definitions (name, description, JSON schema)                                                                                                     |
| `signal`       | Aborts the call                                                                                                                                           |

`instructions` are rebuilt each turn and never stored in `messages`, so they can change between
turns (an edited AGENTS.md) without touching history. The Responses client sends them as the
API's `instructions` field.

`notice` is not history, so an adapter appends it as a last user message after it has built the
history, and leaves it out of anything it hashes or replays. Anthropic's thinking signatures, for
one, are bound to the messages that preceded the reply: a notice inside that hash would make every
later replay fail. Each turn's notice is gone from the next request.

## The context window

A provider may expose `contextWindow`, the size of its model's context in tokens. The loop reads
it before each model call, so a provider that can change model answers for the one its next call
goes to. A provider that doesn't know it leaves it out, and the run goes on without it.
