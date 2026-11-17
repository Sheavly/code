# @sheavly/extension

The extension lifecycle: the Extension contract extensions are written against, and the host that activates them in dependency order, isolates failures, gates trust and merges what they contribute.

An extension is one unit of what a run includes. The framework puts no category or policy on it:
what an extension can and cannot do is its own to define, so others can build extensions without
changing this source. It has a unique kebab-case `name`, `dependsOn`, optional static `settings`
and an `activate` that returns its contributions: tools, hooks and work kinds. Extensions share
typed services with each other through `defineService`, and the app supplies run-level services
any extension can read (`hostService`). An app builds an `ExtensionHost`, which activates them in
dependency order, reports an extension that fails without stopping the rest, skips code that is
not trusted and merges what they contribute for the app to hand to the loop. Depends on
`@sheavly/core` only.

```ts
import { defineExtension, defineSetting } from '@sheavly/extension/extension/extension.utils';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';

const MAX_NOTES = defineSetting({
  name: 'notes.max-notes',
  description: 'How many notes to keep',
  default: 50,
});

const notes = defineExtension({
  name: 'notes',
  settings: [MAX_NOTES],
  activate: ({ settings }) => ({ tools: [createNoteTool(settings.get(MAX_NOTES))] }),
});

const host = new ExtensionHost({ extensions: [notes], settings: { 'notes.max-notes': 100 } });
const { contributions, settings, failed, skipped } = await host.activate({ signal });
// contributions: { tools, hooks, workKinds }, merged in activation order, hooks placed
await host.deactivate();
```

| Module       | What it holds                                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension/` | `Extension`, `Contributions`, `Services`, `Settings`, `defineExtension`, `defineService`, `hostService`, `defineSetting`, `placeHook`: the contract extensions are written against                       |
| `host/`      | `ExtensionHost`: activates extensions in dependency order, isolates failures, gates trust, merges contributions                                                                                          |
| `errors/`    | `ExtensionDefinitionError`, `ExtensionGraphError`, `ContributionCollisionError`, `MissingServiceError`, `ExtensionSettingError`, `HookOrderError`, `ExtensionHostStateError`, `ExtensionActivationError` |

Tests build extensions with `fakeExtension`, `fakeHook` and `fakeTool` from
`@sheavly/extension/testing/extension.fake`.

## Docs

- [Design](docs/design.md): what the package owns, how the contract and the host split, and how to extend it.
- [Lifecycle](docs/lifecycle.md): activation order, failure isolation, trust gating and deactivation.
- [Services](docs/services.md): how extensions share typed services, and what each may read.
- [Contributions](docs/contributions.md): settings an extension declares and reads, and where a hook goes among the others.
