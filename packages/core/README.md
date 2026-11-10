# @sheavly/core

The code contracts tools, hooks and providers are written against: `defineTool` / `runTool`,
`defineHook`, `defineAdapter`, the `Provider` and its `ProviderRequest`, and the `Environment` an
app passes in. No services, no tools of its own: everything else builds on this.

`ProviderRequest.mode` optionally carries `low`, `medium`, `high` or `extreme` reasoning effort
for one call. The caller chooses it; the provider translates it to its API's native settings.
The provider's `done` event may carry `usage`, with reported token counts. Input includes cache
reads and writes, and output includes reasoning when the provider reports it that way. Missing
usage is unknown, not zero; an app may attach a configured cost estimate and model id.

```ts
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { Provider } from '@sheavly/core/provider/provider.types';
```

| Module         | What it holds                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `tool/`        | `Tool` types, `defineTool`, `runTool`, the call's `description` field                                           |
| `hook/`        | `Hook` and its handlers' contexts, `defineHook`                                                                 |
| `provider/`    | `Provider`, `ProviderRequest`, `ToolDefinition`                                                                 |
| `notice/`      | `formatHarnessNotice`: model-facing formatting of shared protocol notices                                       |
| `summary/`     | `Summarizer`, `SummaryOptions` and `SummaryPolicy` (what writes a checkpoint, and when), and `formatCheckpoint` |
| `adapter/`     | `Adapter` types and `defineAdapter`, for model backends                                                         |
| `store/`       | `ConversationStore` and `EntryStore` (where past conversations are kept), `toStoreError`                        |
| `clock/`       | `now()`: the one place a package reads the time, as epoch milliseconds                                          |
| `message/`     | `StreamEvent` and what a provider streams                                                                       |
| `environment/` | `Environment`: settings an app passes in, since packages never read env                                         |
| `validation/`  | `parseOrThrow` / `validate`, which turn zod failures into an area's error                                       |
| `errors/`      | `DefinitionError`, `ToolCallError`, `StoreError`                                                                |

## Docs

- [Writing a tool](docs/tools.md): the `Tool` contract, and the artifacts a tool hands a UI.
- [Hooks](docs/hooks.md): every hook point, and adding one.
- [The provider contract](docs/providers.md): what a model backend implements.
