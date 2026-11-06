# @sheavly/providers

Model backends for the harness, written against `@sheavly/core`'s `Provider` and `Adapter`
contracts and nothing else, so they can be used without the harness. A UI builds its provider
here and passes it in; no other package depends on this one at runtime.

```ts
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';

const provider = createDefaultRegistry().create('openai', {
  apiKey,
  model: 'gpt-6.1-sol',
  // How a call is sent: required, like the model, since it is the caller's choice.
  request: { responseTimeoutMs: 60_000, retries: 2, retryDelayMs: 1000 },
});
```

| Module                | What it holds                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `registry/`           | `AdapterRegistry` (kind + config → `Provider`), `describe`, `validateDefinition`, `check`                   |
| `switch/`             | `ProviderSwitch`: swap the active provider between turns, or pin a run to one                               |
| `http/`               | What every protocol shares: `sendRequest` (timeouts, retries), the SSE reader, config schemas               |
| `responses/`          | The OpenAI Responses protocol: `createResponsesProvider`, `defineResponsesAdapter`                          |
| `anthropic-messages/` | The Anthropic Messages protocol: `createMessagesProvider`, `defineMessagesAdapter`                          |
| `openai/`             | Backend: config → Responses endpoint (Bearer key)                                                           |
| `azure/`              | Backends on Azure: `openai.adapter` (Responses: GPT, DeepSeek, ...), `anthropic.adapter` (Messages: Claude) |
| `errors/`             | `AdapterError`, `ModelApiError`, `ProviderSwitchError`                                                      |
| `testing/`            | Fakes for tests: Responses API items, a model call                                                          |

The caller chooses the backend and the model: adapters validate config but have no default model.
Messages and Responses providers attach reported token usage to the final `done` event. Messages
usage deltas are cumulative; its cache tokens are added to ordinary input. Responses cached input
is already part of its input total, so it is not counted twice. No provider guesses prices.

Messages replies preserve their original content-block order and request-prefix provenance.
Signed thinking is replayed only while that prefix still matches; incompatible legacy thinking
is omitted without losing text or tool calls. See [Model effort modes](docs/backends.md#model-effort-modes).

Azure Claude supports `thinkingMode: 'adaptive'`, budgeted `'enabled'` thinking, and `'disabled'`.
Adaptive thinking takes no fixed budget; `maxTokens` limits output per reply, not the context
window. The registry's connection check gives fixed, actionable explanations for common thinking,
output-limit and rate-limit failures without returning provider error bodies. See
[Models on Azure](docs/backends.md#models-on-azure) and
[checking a model](docs/backends.md#describing-adapters-and-checking-a-model).

## Docs

- [Backends](docs/backends.md): creating and switching providers, describing adapters and checking a
  model, and adding a backend.
