# @sheavly/core

The code contracts tools, hooks and providers are written against: `defineTool` / `runTool`,
`defineHook`, `defineAdapter`, the `Provider` and its `ProviderRequest`, and the `Environment` an
app passes in. No services, no tools of its own: everything else builds on this.

```ts
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Provider } from '@sheavly/core/provider/provider.types';
```

| Module         | What it holds                                                             |
| -------------- | ------------------------------------------------------------------------- |
| `tool/`        | `Tool` types, `defineTool`, `runTool`, the call's `description` field     |
| `hook/`        | `Hook` and its handlers' contexts, `defineHook`                           |
| `provider/`    | `Provider`, `ProviderRequest`, `ToolDefinition`                           |
| `adapter/`     | `Adapter` types and `defineAdapter`, for model backends                   |
| `store/`       | `ConversationStore` and `EntryStore`: where past conversations are kept   |
| `clock/`       | `now()`: the one place a package reads the time, as epoch milliseconds    |
| `message/`     | `StreamEvent` and what a provider streams                                 |
| `environment/` | `Environment`: settings an app passes in, since packages never read env   |
| `validation/`  | `parseOrThrow` / `validate`, which turn zod failures into an area's error |
| `errors/`      | `DefinitionError`, `ToolCallError`, `StoreError`                          |

## Docs

- [Writing a tool](docs/tools.md): the `Tool` contract, and the artifacts a tool hands a UI.
- [Hooks](docs/hooks.md): every hook point, and adding one.
- [The provider contract](docs/providers.md): what a model backend implements.
