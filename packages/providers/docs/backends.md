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

// A provider is added under the model's id, never its display name: the id is what is switched by.
const SOL = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';
const GPT = '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71';

const providers = new ProviderSwitch()
  .add(
    SOL,
    registry.create('openai', {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-6.1-sol',
      request,
    }),
  )
  .add(
    GPT,
    registry.create('azure-openai', {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseUrl: 'https://<resource>.openai.azure.com/openai/v1',
      deployment: '<your-deployment-name>',
      request,
    }),
  );

providers.use(GPT); // swap at runtime; applies from the next model call
```

## Models on Azure

Every model deployed on Azure (Azure OpenAI or Azure AI Foundry) is one of two adapters, both in
`azure/`:

| Model                                                   | Adapter           | `baseUrl`                                            |
| ------------------------------------------------------- | ----------------- | ---------------------------------------------------- |
| GPT on Azure OpenAI                                     | `azure-openai`    | `https://<resource>.openai.azure.com/openai/v1`      |
| Foundry models on `/responses` (DeepSeek V4 Flash, ...) | `azure-openai`    | `https://<resource>.services.ai.azure.com/openai/v1` |
| Claude                                                  | `azure-anthropic` | `https://<resource>.services.ai.azure.com/anthropic` |

`deployment` is the deployment name in the portal. A model whose `/responses` sends no encrypted
reasoning back takes `reasoning: false`. Claude needs `maxTokens`: the maximum output tokens per
reply, not the context window. Set it within the deployment's output limit, for example 8192.
`thinkingMode: 'adaptive'` lets supported models choose their own thinking budget, with no
`thinkingBudget`. Models such as Sonnet 5.5 require adaptive rather than enabled thinking.
`thinkingMode: 'enabled'` requires `thinkingBudget` (at least 1024, under `maxTokens`);
`'disabled'` turns thinking off. For existing configurations without a mode, a budget enables
thinking and no budget leaves thinking unspecified:

```ts
registry.create('azure-anthropic', {
  apiKey: process.env.AZURE_CLAUDE_KEY,
  baseUrl: 'https://<resource>.services.ai.azure.com/anthropic',
  deployment: 'claude-sonnet',
  maxTokens: 16_000,
  thinkingMode: 'adaptive',
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

## Describing adapters, and checking a model

A UI that sets a model up never imports this package. The backend reads the registry for it:

- `registry.describe()` lists every adapter for a form: its config as JSON Schema, without what the
  backend supplies (the request policy), with the secret fields marked (`secret: true`), the names
  of the secrets, and `remoteField`, the field that holds what the provider calls the model
  (`model`, `deployment`). Fields carry a `title` and `description` for labels and help.
- `registry.validateDefinition({ kind, definition, host })` says what is wrong with a model's
  fields before any key exists: the secret is stood in for, `host` supplies the request policy, and
  the adapter's own schema judges the rest. A key inside a definition is itself a problem, since a
  model's file holds none. `registry.secretFields(kind)` says which fields are secrets.
- `registry.check({ kind, config })` asks the model one tiny question through the adapter's own
  provider and stops at the first thing it says, so the key, the endpoint and the deployment are
  all tried at once. It never retries, gives up after `responseTimeoutMs`, and ends as `valid`,
  `invalid` (401/403), `not_found` (404), `rejected` (any other refusal) or `unreachable` (a server
  failure, the network, a timeout). HTTP 400/422 messages explain known adaptive-thinking and
  output-limit failures, or point to the settings to check; HTTP 429 says to retry or check quota.
  These are fixed explanations, never the provider's error text, which can echo what was sent.
  Aborting `signal` rejects instead; that is not an answer.

What marks a field is in its schema, so an adapter that reuses `apiKeySchema` and
`requestPolicySchema` is described correctly with nothing more. A field named like a secret that is
not marked one fails a test for every registered adapter.

`providers.pinned(key)` hands out the provider added under `key` and keeps it there whatever the
switch is set to, for a run pinned to one model (a sub-agent) while the main session switches. A
host adds each provider under a model's id; a display name is never a key.

### Model effort modes

The backend selects low, medium, high or extreme independently for each model and conversation.
`ProviderSwitch.setMode` changes future calls, with the effort captured in `ProviderRequest.mode`
when the stream begins. `pinned` captures that effort as well as the provider, so a sub-agent is
not moved by a later switch.

Responses APIs receive `reasoning.effort` (low, medium, high, or xhigh for extreme). The
Anthropic Messages API receives adaptive thinking and `output_config.effort` (low, medium, high,
or max for extreme), with no fixed thinking budget. Completed Messages replies are kept as opaque
replay state, with their original text, thinking and tool-block order and a hash of the request
prefix. Signed thinking is replayed only when system instructions, tools and preceding messages
still match. Legacy thinking without that provenance, or thinking after an edited prefix, is
left out while text and tool calls remain. This also permits recovery from older saved chats
without replaying invalid signatures. The AGENTS.md and skills hooks append updates to history
rather than rewriting the system prompt. See
[preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking).
This requires a deployment supporting those native effort levels; an unsupported
setting is reported by the provider, never silently relabelled as another mode. Calls without
an effort mode retain their configured thinking behavior. See
[Anthropic's effort reference](https://platform.claude.com/docs/en/build-with-claude/effort).

Azure Claude's `maxTokens` defaults to 8192. It remains an independent output limit, not an
effort mode or context window setting. The setup form fills optional defaults without asking;
advanced settings can still override the output limit.

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
