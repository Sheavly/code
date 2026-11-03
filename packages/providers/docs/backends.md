# Backends

Creating a provider from the registry, switching between them, and adding a backend.

## Creating and switching providers

Every adapter is created from the registry with a config object that is checked by zod:

```ts
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { ProviderSwitch } from '@sheavly/providers/switch/switch.service';

const registry = createDefaultRegistry();

const providers = new ProviderSwitch()
  .add(
    'sol',
    registry.create('openai', { apiKey: process.env.OPENAI_API_KEY, model: 'gpt-6.1-sol' }),
  )
  .add(
    'azure',
    registry.create('azure', {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseUrl: 'https://<resource>.openai.azure.com/openai/v1',
      deployment: '<your-deployment-name>',
    }),
  );

providers.use('azure'); // swap at runtime; applies from the next model call
```

Pass `providers` as the `provider` option of `runAgent`.

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
