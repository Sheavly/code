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
| `grants`                      | Optional. `<noun>:<verb>` capabilities (lowercase kebab parts, one colon, no duplicates) it asks of the host's per-extension services; see [`grants`](#grants).                                                                                                                                                                   |
| `emits`, `serves`             | `emits` is enforced (see below); `serves` is reserved.                                                                                                                                                                                                                                                                            |

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

## `grants`

`grants: string[]` lists the verb-level capabilities the extension asks of the host's
per-extension services (`task:start`, `output:read`, `sub-agent:message`): `<noun>:<verb>`, each
part lowercase words joined by hyphens, one colon, no duplicates. It is data, so an installer can
show what an extension may do before running it.

A grant belongs to a service. The host supplies some services as factories (`hostServiceFor`) that
build one value per extension, and each declares the grants it understands; the host's
**catalogue** is the union of what the services it was given declare (a plain `hostService` value
declares none, and a grant a dependency's own provided service might define is out of scope: only
host services define grants). At activation the host fails an extension, before its `activate`
runs, with an `ExtensionGrantError` naming the extension and the grant when:

- a grant is in no supplied service's catalogue (a typo fails, and so does a grant of a service the
  app did not supply), or
- a grant belongs to a service the extension cannot read, that is, not in its `services.requires`
  or `services.optional`.

Each service then enforces its own grants per method: the factory receives `{ name, manifest }`
and every method calls `requireGrant({ extension, grants, grant })`
(`@sheavly/extension/extension/grants.utils`), which throws an `ExtensionUndeclaredError`
(`use: 'grant'`, naming the grant, to be added to `grants`). A grant is a declaration the host
checks, not a sandbox: see [what the manifest is not](#what-the-manifest-is-not).

## `emits`, and the reserved `serves`

`emits: { events: string[]; modelFacingNotices: boolean }` declares what the extension may send
to a session through `context.emit`. `events` lists exact event kinds, `<extension>.<kind>` with
the manifest's name as the prefix (kebab parts, no wildcard). `modelFacingNotices: true` allows
notices to the model; their topics are not listed, but each is `<extension>.<name>` too. The
code supplies the schema of each: `activate` returns `events: [{ kind, version, schema }]` and
`notices: [{ topic, version, schema }]`, and the host holds both to the manifest (see
[what the host enforces](#what-the-host-enforces)).

`serves: { actions: string[] }` is validated (action names are `<extension>.<kind>`) but **not
enforced by the host**: actions do not exist in the harness yet. It is in the schema so a manifest
can declare them without a format change later.

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
- **Before activating, for `grants`**: each must be in the catalogue of the supplied services and
  belong to a service the extension reads, else it fails (`ExtensionGrantError`, in `result.failed`,
  dependents skipped) without running `activate`. See [`grants`](#grants).
- **During `activate`**: `services.get` for a name not in `requires` or `optional`, `services.find`
  for one not in `optional` or `requires`, and `services.provide` for one not in `provides` throw at
  the call. Services the host supplies are held to the same list: an extension that reads
  `sessions` must declare it, which is what lets an installer warn about it.
- **After `activate` returns**: a contributed tool, hook or work kind not listed in `tools`,
  `hooks` or `workKinds` (exactly, or by a wildcard entry) fails the activation. The extension is deactivated (it had activated), its
  services are dropped and its dependents are skipped. The host reads each name once, keeps what
  it checked and merges only that; if the lists or a name changed before the merge (the extension
  keeps its references while others activate), the extension fails the same way, with an
  `ExtensionContributionChangedError`, and its dependents are rolled back too. The same holds for
  `events` (each `kind` must be listed exactly in `emits.events`) and `notices` (needs
  `emits.modelFacingNotices: true`, and each `topic` must start with `<extension>.`), whose lists
  the re-verification covers, and whose names collide like any other contribution.
- **At each emit** (`context.emit.event` / `.notice`): before `activate` has returned and passed the
  check above it throws "not activated yet". It then accepts only a kind or topic the extension
  contributed (an undeclared one is an `ExtensionUndeclaredError`, a declared one it never
  contributed an `ExtensionEmitError`), takes the `version` from the contribution, never from the
  caller, parses `data` against the contributed schema (an `ExtensionEmitError` naming the
  extension, the kind and the issue paths, never the values; a schema or data that throws, such as
  a cycle or a throwing getter, is the same error), and then parses the finished envelope with the
  protocol's own event or notice schema, which holds the name and namespace, the version, `text`
  (1 to 2000 characters) and the serialized `data` (16384 bytes) to the stream's and history's
  caps (`invalid-envelope`). The kind or topic in a message is quoted and truncated. Without an
  emit sink from the app, an emit throws.
- **Contributions are armed from what was recorded.** Each event kind and notice topic must be
  `<extension>.<name>` in the extension's namespace and each `version` a positive integer, or the
  activation fails (`invalid-contribution`), naming the extension. The emitter is armed from the
  names and versions read once at that check, never from the live objects (a schema is held by
  reference).
- **`emit` ends with the extension.** The host disarms it wherever it stops, drops or fails the
  extension: `deactivate()`, a roll-back for a changed contribution (and its dependents), a late
  stop, a collision or abort, a failed `activate` or contribution check. Afterwards every emit
  throws `deactivated`, so a tool or task that kept `context.emit` cannot publish. It is disarmed
  before the extension's own `deactivate()` runs.

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
- **`emits` is a host-checked gate, not a sandbox.** The host checks what passes through
  `context.emit`; an extension is Node code, so nothing stops it from reaching a session's stream
  by another route: the `sessions` run service, which an extension may declare and read, is the
  session registry itself, and `publish` and `queueNotice` are on it. The sink is an option of the
  host, not a service, so an extension that only holds the emit capability cannot emit under
  another's name. `sessions` remains a bypass: its holder skips the declaration and can name any
  extension in the envelope, which is impersonation to the model (the registry refuses a malformed
  notice and caps the outbox, but does not check who it names). Narrower services (#336) are where
  that closes. The `session` an emit names can be any session of the run, sub-agents included; it
  cannot cross conversations, because one registry serves one conversation.
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
