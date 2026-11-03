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

| Module       | What it holds                                                                      |
| ------------ | ---------------------------------------------------------------------------------- |
| `registry/`  | `AdapterRegistry` (kind + config → `Provider`) and `createDefaultRegistry`         |
| `switch/`    | `ProviderSwitch`: swap the active provider between turns                           |
| `responses/` | The OpenAI Responses protocol: `createResponsesProvider`, `defineResponsesAdapter` |
| `openai/`    | Backend: config → Responses endpoint (Bearer key)                                  |
| `azure/`     | Backend: config → Responses endpoint (api-key, api-version, deployment)            |
| `errors/`    | `AdapterError`, `ResponsesApiError`, `ProviderSwitchError`                         |
| `testing/`   | Fakes for tests: Responses API items                                               |

The caller chooses the backend and the model: adapters validate config but have no default model.

## Docs

- [Backends](docs/backends.md): creating and switching providers, and adding a backend.
