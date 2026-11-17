# @sheavly/extension

The extension lifecycle: the Extension contract extensions are written against, and the host that activates them in dependency order, isolates failures, gates trust and merges what they contribute.

An extension is one unit of what a run includes. The framework puts no category or policy on it:
what an extension can and cannot do is its own to define, so others can build extensions without
changing this source. It ships a data-only `sheavly.json` manifest that declares its unique
kebab-case `name`, `dependsOn`, services, settings and the names it contributes, and an `activate`
that returns its contributions: tools, hooks and work kinds. The host holds it to its manifest
(a name ending in `*` declares names that are not known in advance, such as a workspace's own hooks).
The manifest is not a sandbox: an extension is Node code, and the host checks only what it mediates
(see [What the manifest is not](docs/manifest.md#what-the-manifest-is-not)).
Extensions share typed services with each other through `defineService`, and the app supplies
run-level services any extension can read (`hostService`). An app builds an `ExtensionHost`, which
activates them in dependency order, reports an extension that fails without stopping the rest,
skips code that is not trusted and merges what they contribute for the app to hand to the loop.
Depends on `@sheavly/core` only.

```ts
import { defineExtension, settingKey } from '@sheavly/extension/extension/extension.utils';
import { readManifest } from '@sheavly/extension/manifest/manifest.helper';
import { ExtensionHost } from '@sheavly/extension/host/extension-host.service';

// extensions/notes/sheavly.json declares the name, the setting `notes.max-notes` and the tool
// `add_note`; src/<folder>/ and dist/<folder>/ are both two levels below the package root.
const manifest = readManifest(new URL('../../sheavly.json', import.meta.url));
const MAX_NOTES = settingKey({ manifest, name: 'notes.max-notes', type: 'number' });

const notes = defineExtension({
  manifest,
  activate: ({ settings }) => ({ tools: [createNoteTool(settings.get(MAX_NOTES))] }),
});

const host = new ExtensionHost({ extensions: [notes], settings: { 'notes.max-notes': 100 } });
const { contributions, settings, failed, skipped } = await host.activate({ signal });
// contributions: { tools, hooks, workKinds }, merged in activation order, hooks placed
await host.deactivate();
```

| Module       | What it holds                                                                                                                                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension/` | `Extension`, `ExtensionDefinition`, `Contributions`, `Services`, `Settings`, `defineExtension`, `defineService`, `hostService`, `settingKey`, `placeHook`: the contract extensions are written against                                                                                              |
| `manifest/`  | `readManifest` (helper: reads and validates a `sheavly.json` without running the extension), `ExtensionManifest` and `SettingManifest` (types), `manifestJsonSchema` (utils); the zod schema is internal. The JSON Schema for editors is `sheavly.schema.json`                                      |
| `host/`      | `ExtensionHost`: activates extensions in dependency order, isolates failures, gates trust, holds each extension to its manifest, merges contributions                                                                                                                                               |
| `errors/`    | `ExtensionDefinitionError`, `ExtensionManifestError`, `ExtensionUndeclaredError`, `ExtensionContributionChangedError`, `ExtensionGraphError`, `ContributionCollisionError`, `MissingServiceError`, `ExtensionSettingError`, `HookOrderError`, `ExtensionHostStateError`, `ExtensionActivationError` |

Tests build extensions with `fakeExtension`, `fakeHook` and `fakeTool` from
`@sheavly/extension/testing/extension.fake`.

## Docs

- [Design](docs/design.md): what the package owns, how the contract and the host split, and how to extend it.
- [Manifest](docs/manifest.md): the `sheavly.json` every extension ships, each field, how an installer reads it and how the host enforces it.
- [Lifecycle](docs/lifecycle.md): activation order, failure isolation, trust gating and deactivation.
- [Services](docs/services.md): how extensions share typed services, and what each may read.
- [Contributions](docs/contributions.md): settings an extension declares and reads, and where a hook goes among the others.
