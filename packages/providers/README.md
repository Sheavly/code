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

| Module                | What it holds                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `registry/`           | `AdapterRegistry` (kind + config → `Provider`), `describe`, `validateDefinition`, `check`     |
| `switch/`             | `ProviderSwitch`: swap the active provider between turns, or pin a run to one                 |
| `http/`               | What every protocol shares: `sendRequest` (timeouts, retries), the SSE reader, config schemas |
| `responses/`          | The OpenAI Responses protocol: `createResponsesProvider`, `defineResponsesAdapter`            |
| `anthropic-messages/` | The Anthropic Messages protocol: `createMessagesProvider`, `defineMessagesAdapter`            |
| `openai/`             | Backend: config → Responses endpoint (Bearer key)                                             |
| `azure/`              | Backend: config → Responses endpoint (api-key, api-version, deployment): GPT, DeepSeek, ...   |
| `azure-anthropic/`    | Backend: config → Messages endpoint on Azure AI Foundry (x-api-key, deployment): Claude       |
| `errors/`             | `AdapterError`, `ModelApiError`, `ProviderSwitchError`                                        |
| `testing/`            | Fakes for tests: Responses API items, a model call                                            |

The caller chooses the backend and the model: adapters validate config but have no default model.

## Docs

- [Backends](docs/backends.md): creating and switching providers, describing adapters and checking a
  model, and adding a backend.
