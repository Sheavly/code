# Backends

Creating a provider from the registry, switching between them, and adding a backend.

## Creating and switching providers

Every adapter is created from the registry with a config object that is checked by zod. The
caller picks the model and how each call is sent (`request`); neither has a default:

```ts
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { ProviderSwitch } from '@sheavly/providers/switch/switch.service';

const registry = createDefaultRegistry();
const request = { responseTimeoutMs: 60_000, retries: 2, retryDelayMs: 1000 };

const providers = new ProviderSwitch()
  .add(
    'sol',
    registry.create('openai', {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-6.1-sol',
      request,
    }),
  )
  .add(
    'azure',
    registry.create('azure', {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseUrl: 'https://<resource>.openai.azure.com/openai/v1',
      deployment: '<your-deployment-name>',
      request,
    }),
  );

providers.use('azure'); // swap at runtime; applies from the next model call
```

## Models on Azure

Every model deployed on Azure (Azure OpenAI or Azure AI Foundry) is one of two adapters:

| Model                                                   | Adapter           | `baseUrl`                                            |
| ------------------------------------------------------- | ----------------- | ---------------------------------------------------- |
| GPT on Azure OpenAI                                     | `azure`           | `https://<resource>.openai.azure.com/openai/v1`      |
| Foundry models on `/responses` (DeepSeek V4 Flash, ...) | `azure`           | `https://<resource>.services.ai.azure.com/openai/v1` |
| Claude                                                  | `azure-anthropic` | `https://<resource>.services.ai.azure.com/anthropic` |

`deployment` is the deployment name in the portal. A model whose `/responses` sends no encrypted
reasoning back takes `reasoning: false`. Claude needs `maxTokens`, and `thinkingBudget` (at least
1024, under `maxTokens`) turns on extended thinking:

```ts
registry.create('azure-anthropic', {
  apiKey: process.env.AZURE_CLAUDE_KEY,
  baseUrl: 'https://<resource>.services.ai.azure.com/anthropic',
  deployment: 'claude-sonnet',
  maxTokens: 16_000,
  thinkingBudget: 4096,
  request,
});
```

Pass `providers` as the `provider` option of `runAgent`.

## Sending a call: timeouts and retries

`request` decides how each call is sent, in every protocol (`http/request.helper.ts`):

- `responseTimeoutMs`: how long to wait for the response to start (its headers). Without it a
  backend that accepts a call and never answers holds the run for Node's five minutes. It covers
  the start only: a long reply streams for as long as it takes.
- `retries` and `retryDelayMs`: a call that fails before anything streamed is sent again, up to
  `retries` more times, waiting `retryDelayMs`, doubled each time (or the server's `retry-after`,
  if longer). It retries a request that never reached the server, one that timed out, HTTP 429
  and 5xx; any other HTTP error fails at once. Once an event has streamed it never retries, since
  the turn may have started tools: a stream cut off mid-reply fails the run.
- An interrupt (the run's `signal`) stops the wait and every attempt, and is never retried.

A call that still fails throws a `ModelApiError` (its message names the API) whose `reason` says why (`network`,
`timeout`, `http` with its `status`), with the original error as `cause` and Node's own reason
in the message (`UND_ERR_SOCKET: other side closed`), so a saved run says what happened.

## Adding a backend

- **It speaks the Responses API** (OpenAI-compatible gateways, local servers that support it): a
  folder `src/<name>/` with `<name>.adapter.ts` calling `defineResponsesAdapter({ kind,
description, configSchema, toEndpoint })`. `toEndpoint` is a pure map from validated config to
  base URL, model, headers and query; streaming, tool calls and reasoning are shared. Test the
  mapping in `src/<name>/__tests__/` with `requestSentBy` from `@sheavly/testing/fetch/fake-fetch.fake`.
- **It speaks the Anthropic Messages API** (Claude on Azure AI Foundry, or elsewhere): the same,
  with `defineMessagesAdapter` from `anthropic-messages/messages.helper.ts`; its config also has
  `maxTokens` (the API requires it) and an optional `thinkingBudget` (extended thinking, whose
  signed blocks are resent like Responses reasoning). Test it with `requestSentBy(..., reply:
[{ type: 'message_stop' }])`, so the fake ends the stream the Messages way.
- **It speaks another protocol** (Google Gemini, Chat Completions): a protocol folder next to
  `responses/` and `anthropic-messages/` with its own `create<Name>Provider` that turns a
  `ProviderRequest` into that API's request and its stream into `StreamEvent`s, and backends built
  on it. What every protocol shares is in `http/` (`sendRequest`, the SSE reader, the config
  schemas, `parseToolArguments`); nothing in one protocol's folder is reused by another. Reasoning
  items keep a `source` naming the protocol, endpoint and model, so one provider's reasoning is
  never sent to another.
- Register it in `createDefaultRegistry` if it is built in, or `registry.register(adapter)` from
  the caller.
