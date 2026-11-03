# @sheavly/providers

Model backends for the harness. Everything here is written against `@sheavly/core` (the
`Provider` and `Adapter` contracts) and `zod`; nothing imports the app (`rootDir` makes that a
type error), so the adapters can be used without the harness.

```
src/
  responses/    the OpenAI Responses protocol: createResponsesProvider, defineResponsesAdapter,
                SSE reader, event and input mapping
  openai/       backend: config → Responses endpoint (Bearer key)
  azure/        backend: config → Responses endpoint (api-key, api-version, deployment)
  registry/     AdapterRegistry (kind + config → Provider) and createDefaultRegistry
  switch/       ProviderSwitch: swap the active provider between turns
  errors/       AdapterError, ResponsesApiError, ProviderSwitchError
```

The caller chooses the backend and the model: adapters validate config but have no default model.
The harness's hosts keep theirs in `@sheavly/host` (`packages/host/src/host/host.constants.ts`).

## Adding a backend

- **It speaks the Responses API** (OpenAI-compatible gateways, local servers that support it): a
  folder `src/<name>/` with `<name>.adapter.ts` calling `defineResponsesAdapter({ kind,
description, configSchema, toEndpoint })`. `toEndpoint` is a pure map from validated config to
  base URL, model, headers and query; streaming, tool calls and reasoning are shared. Test the
  mapping in `src/<name>/__tests__/` with `requestSentBy` from `@sheavly/testing/fetch/fake-fetch.fake`.
- **It speaks another protocol** (Anthropic Messages, Google Gemini, Chat Completions): a protocol
  folder next to `responses/` (`src/anthropic-messages/`, ...) with its own `create<Name>Provider`
  that turns a `ProviderRequest` into that API's request and its stream into `StreamEvent`s, and
  backends built on it. Only the `Provider` contract is shared: nothing in `responses/` is reused
  or extended for another protocol. Reasoning items keep a `source` naming the protocol, endpoint
  and model, so one provider's reasoning is never sent to another.
- Register it in `createDefaultRegistry` if it is built in, or `registry.register(adapter)` from
  the caller.
