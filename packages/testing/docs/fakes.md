# Fakes

What each fake stands in for, and which to reach for. Tests never touch the network or a real
model: a provider fake plays the model, and `fakeFetch` plays the API behind a real backend.

## Playing the model

| Fake                          | Reply                                                                          | Use it when                                                      |
| ----------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `scriptedProvider(responses)` | Call N plays back `responses[N]`, in order                                     | One session, a fixed sequence of turns                           |
| `callOnceProvider(call)`      | One tool call, then the turn ends                                              | The most common script: test one tool through the loop           |
| `routedProvider(scripts)`     | Each session's first user message picks its script; each step sees the request | The main session and its sub-agents each follow their own script |

`routedProvider`'s steps are `Script`s, `(request) => StreamEvent[]`, built with `say(text)` (text,
then the turn ends) and `calls(...events)` (tool calls), and `toolCall({ id, name, input })`,
which adds the call description the harness requires. A step sees the request it answers, so it
can assert on the instructions or tools the model was sent. The last step repeats.

```ts
const provider = routedProvider({
  'parse it': [calls(toolCall({ id: 'c1', name: 'extract', input: { line } })), say('42.50')],
});
```

## Playing the API

`fakeFetch(events, status?)` is a `fetch` that answers every request with the same Responses SSE
stream (or an HTTP error), and records what it was sent. `fakeFetchSequence({ responses })`
answers request N with `responses[N]`, for multi-turn runs; each reply ends with
`response.completed` unless `complete: false`, a stream cut off mid-reply. `requestSentBy` gives
the request an adapter sends for one message, which is how a backend's mapping is tested
(`@sheavly/providers`). Use these to test a real backend; a provider fake for anything above it.

## Running tools and waiting

- `toolRunner(tools)` calls tools by name, as the loop does, with the call description it
  requires: a tool's own tests, without a model.
- `until(check)` polls until `check()` is true. Background tasks and sub-agents finish on their
  own schedule, so a test waits on the state it expects, never on a fixed delay.

## Not here

A package's fakes for its own services stay in its `src/testing/`, exported as `./testing/*`
from source only: `@sheavly/runtime/testing/` (sessions, approvals, `startTaskTool`),
`@sheavly/workspace/testing/` (`useTempWorkspace`, `useFileLocks`, `testProcesses`),
`@sheavly/providers/testing/` (Responses items) and core's echo tool, since core can't depend on
this package.
