# The manifest (`sheavly.json`)

Every extension ships a data-only `sheavly.json` at the root of its workspace
(`extensions/<name>/sheavly.json`). It is the single source for the extension's `name`,
`dependsOn` and settings, and it lists what the extension needs and does. Because it is data,
something can read it without running the extension: an installer can warn about what an extension
asks for before any of its code runs, and the host checks the extension's behaviour against it.

## The file

Strict JSON: no comments, no trailing commas, parsed with `JSON.parse`. Unknown keys are rejected
at every level, so a typo fails instead of silently declaring nothing. Only `name` is required;
every other field defaults to empty.

```json
{
  "$schema": "./sheavly.schema.json",
  "name": "notes",
  "dependsOn": ["files"],
  "services": { "requires": ["sessions"], "optional": ["outputs"], "provides": ["notes-store"] },
  "settings": [
    {
      "name": "notes.max-notes",
      "type": "number",
      "default": 50,
      "description": "How many to keep"
    }
  ],
  "tools": ["add_note"],
  "hooks": ["notes-instructions"],
  "workKinds": ["notes.sync"]
}
```

| Field                         | Meaning                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$schema`                     | Optional. The JSON Schema the file follows, so an editor validates it: `sheavly.schema.json` at this package's root.                                                                                                                                                                                                              |
| `name`                        | Required. Unique, kebab-case (`EXTENSION_NAME_PATTERN`).                                                                                                                                                                                                                                                                          |
| `dependsOn`                   | Extension names (kebab-case) that activate first and whose services become readable. No duplicates, not the extension itself.                                                                                                                                                                                                     |
| `services.requires`           | Service names (kebab-case, as in `defineService('name')`; never a `*`) the extension reads with `services.get`. It cannot activate without them.                                                                                                                                                                                  |
| `services.optional`           | Service names it reads with `services.find`. A name is not both required and optional.                                                                                                                                                                                                                                            |
| `services.provides`           | Service names it gives with `services.provide`.                                                                                                                                                                                                                                                                                   |
| `settings`                    | `{ name, type, default, description }` per setting. `name` is `<extension>.<setting>` and its prefix is the manifest's `name`; `type` is `string`, `number` or `boolean`, and `default` has that type.                                                                                                                            |
| `tools`, `hooks`, `workKinds` | The names the extension contributes (`Contributions.tools[].name`, `hooks[].name`, `workKinds[].name`; a placed hook by its inner hook's name). No duplicates. A declared name may go unused: an extension can contribute some only under options. An entry ending in `*` is a [wildcard](#wildcards-names-not-known-in-advance). |
| `emits`, `serves`             | Reserved, see below.                                                                                                                                                                                                                                                                                                              |

Every list rejects a repeated name, and the schema reports where: `tools[2]`, `settings[0].default`.

## Wildcards: names not known in advance

Some extensions contribute names that something else chooses at run time: a workspace's own hook
files, for one. An entry of `tools`, `hooks` or `workKinds` that ends in `*` is a prefix wildcard
and matches every contributed name that starts with the text before it: `"project-hooks.*"`
declares `project-hooks.audit` and `project-hooks.lint`. The `*` is valid only once and only as
the last character (`a*b`, `*a` and `a**` are rejected). A bare `"*"` matches every name and is
accepted in `hooks` only; in `tools` and `workKinds` give a prefix. A wildcard cannot be narrower
than the host's other checks: a collision of two names is still an error.

An installer should show a wildcard as "contributes tools/hooks whose names are not known in
advance", not as a name, and a bare `"*"` as the widest form of it. Prefer a prefix over `"*"`
whenever the extension controls the names.

A wildcard makes the declared set open-ended, so the hook-name check no longer says anything
about what is contributed. The coding extension declares its hooks with a bare `"*"`: a workspace's
own hook files choose their names, and renaming them would change stored histories. For coding the
hook-name check is therefore a no-op, and the four names listed beside the `"*"`
(`agents-md`, `skills`, `scratch`, `working-root`) are documentation of what it contributes, not a
limit. Its tools are still held to the exact list. The services and settings checks are unaffected.

## Reserved: `emits` and `serves`

`emits: { events: string[]; modelFacingNotices: boolean }` and `serves: { actions: string[] }` are
validated (event kinds and action names are `<extension>.<kind>` with the manifest's name as the
prefix, kebab parts) but **not enforced by the host**: events, model-facing notices and actions do
not exist in the harness yet, so there is nothing to check an extension against. They are in the
schema now so a manifest can declare them without a format change later, and so a typo in them
already fails.

## Reading it

`readManifest(source: string | URL): ExtensionManifest` (`@sheavly/extension/manifest/manifest.helper`)
reads the file synchronously, parses it as JSON and validates it with the schema. It throws an
`ExtensionManifestError` that names the file and lists every problem (invalid JSON, an unknown key,
a wrong type). It is the one place in the package that touches the file system.

It reads only a regular file of at most 256 KiB (a directory, pipe or device, or a larger file, is
an error), says so when a leading byte order mark is why the JSON does not parse, and cuts short
and strips control characters from whatever it echoes from the file's content (the `JSON.parse`
snippet, a key name). Names are at most 128 characters and a list at most 1000 entries.

- **An installer** reads a manifest before running any of the extension's code:
  `readManifest(path)` gives the `name`, `dependsOn`, services, settings and contributed names to
  show and to warn on.
- **An extension** reads its own, from its helper at `src/<folder>/<name>.helper.ts` (built to
  `dist/<folder>/<name>.helper.js`), two levels below the package root in both layouts:

```ts
const manifest = readManifest(new URL('../../sheavly.json', import.meta.url));

export const notes = defineExtension({ manifest, activate });
```

`defineExtension` takes the manifest and derives the extension's `name`, `dependsOn` and
`settings` from it; they are never repeated in code. It validates the manifest again, so one built
in memory is held to the same rules as a file. It holds a deep-frozen copy, so changing the object
passed in afterwards changes nothing, and a manifest that is not an object throws an
`ExtensionDefinitionError`.

## Settings keys

A typed key refers to a manifest entry: `settingKey({ manifest, name: 'notes.max-notes', type: 'number' })`
is a `SettingKey<number>` whose default and description are the manifest's. It throws an
`ExtensionDefinitionError` when the manifest does not declare the name or declares another type.

## What the host enforces

The host holds an extension to its manifest and fails loudly, naming the extension, what it did and
the name (`ExtensionUndeclaredError`).

- **Before activating**: each name in `services.requires` must be readable by the extension, supplied
  by the host or provided by one of its dependencies. If not, the extension is not activated and is
  `skipped` with the reason `service` and the `missing` names. What depends on it is skipped for
  `dependency`; the other extensions are unaffected.
- **During `activate`**: `services.get` for a name not in `requires` or `optional`, `services.find`
  for one not in `optional` or `requires`, and `services.provide` for one not in `provides` throw at
  the call. Services the host supplies are held to the same list: an extension that reads
  `sessions` must declare it, which is what lets an installer warn about it.
- **After `activate` returns**: a contributed tool, hook or work kind not listed in `tools`,
  `hooks` or `workKinds` (exactly, or by a wildcard entry) fails the activation. The extension is deactivated (it had activated), its
  services are dropped and its dependents are skipped. The host reads each name once, keeps what
  it checked and merges only that; if the lists or a name changed before the merge (the extension
  keeps its references while others activate), the extension fails the same way, with an
  `ExtensionContributionChangedError`, and its dependents are rolled back too.

The host works from one deep-frozen copy of each extension's manifest, taken when it receives the
extensions: `requires`, the service views, the contribution check and the settings all read that
copy, and the extension's `name`, `dependsOn` and settings are derived from it. A setting is read
through the manifest's declaration (its default and type), never through what the key says.

Both failures land in `failed` as an `ExtensionActivationError` whose `cause` is the
`ExtensionUndeclaredError` or the `ExtensionContributionChangedError`. There is no way to switch
the host's own checks off: a test that contributes something declares it (`fakeExtension` builds
the manifest from what the test says). That is about the host's checks only; see below for what
they do not cover.

## What the manifest is not

- **Not a sandbox.** An extension is Node code: it can use `fs`, `child_process`, `fetch` and
  `process.env` without declaring them. The manifest declares only the capabilities the host
  mediates (the run and extension services, the contributions the host merges, settings), and the
  host's checks cover those.
- **Item objects are not frozen.** Tools, work kinds and hooks are kept as the extension returned
  them. The host records and merges the names it checked and re-verifies them (and the lists)
  right before the merge, but a getter that changes what an object does or says after the merge is
  the extension's own responsibility: an extension is Node code.
- **`readManifest` stats a file, then reads it.** A path swapped for a FIFO between the two can
  block the read. That needs write access to the extension's own directory.
- **Wildcards make a declared set open-ended**, including coding's bare `*` for hooks (see
  above). An installer should not read a wildcard as a list.
- **The `sub-agents` service grants a right the lists do not show.** The agents extension provides
  it, and whoever reads it can share tools and hooks with sub-agents without those names
  appearing in its own `tools` or `hooks` (`share` is a service call, not a contribution).
  Declaring `sub-agents` in `requires` (or `optional`) therefore grants that right, and an
  installer should treat it as such.
- **The JSON Schema is the shape only.** `readManifest` is authoritative: cross-field rules
  (a setting under the extension's own name, a name both required and optional, a dependency on
  itself) are not expressible in it.
- **A service key matches by name, not identity.** Two `defineService('x')` keys are the same
  service to the host.
- **`readManifest(string)` is not confined to a root.** An installer must not pass it an untrusted
  path.
- **A required service of an extension this one does not depend on is skipped as missing.** What
  is readable depends on `dependsOn`, so it also depends on activation order: an extension must
  `dependsOn` the provider of what it requires.

## The JSON Schema

`sheavly.schema.json` is generated from the zod schema (`z.toJSONSchema`) and committed at the
package root. After changing `manifest/manifest.validator.ts`, run `npm run schema -w @sheavly/extension`;
a test fails while the file is out of date.
