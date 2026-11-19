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
  "instructions": ["notes-guidance"],
  "grants": ["system-prompt:extend"],
  "workKinds": ["notes.sync"]
}
```

| Field                         | Meaning                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$schema`                     | Optional. The JSON Schema the file follows, so an editor validates it: `sheavly.schema.json` at this package's root.                                                                                                                                                                                                                                                                                      |
| `name`                        | Required. Unique, kebab-case (`EXTENSION_NAME_PATTERN`).                                                                                                                                                                                                                                                                                                                                                  |
| `dependsOn`                   | Extension names (kebab-case) that activate first and whose services become readable. No duplicates, not the extension itself.                                                                                                                                                                                                                                                                             |
| `services.requires`           | Service names (kebab-case, as in `defineService('name')`; never a `*`) the extension reads with `services.get`. It cannot activate without them.                                                                                                                                                                                                                                                          |
| `services.optional`           | Service names it reads with `services.find`. A name is not both required and optional.                                                                                                                                                                                                                                                                                                                    |
| `services.provides`           | Service names it gives with `services.provide`.                                                                                                                                                                                                                                                                                                                                                           |
| `services.grants`             | Optional. An object from a service this extension provides to the `<noun>:<verb>` grants that service understands (`{ "sub-agents": ["sub-agent:share"] }`); keys must be in `services.provides`. See [`services.grants`](#servicesgrants).                                                                                                                                                               |
| `settings`                    | `{ name, type, default, description }` per setting. `name` is `<extension>.<setting>` and its prefix is the manifest's `name`; `type` is `string`, `number` or `boolean`, and `default` has that type.                                                                                                                                                                                                    |
| `tools`, `hooks`, `workKinds` | The names the extension contributes (`Contributions.tools[].name`, `hooks[].name`, `workKinds[].name`; a placed hook by its inner hook's name). No duplicates. A declared name may go unused: an extension can contribute some only under options. An entry ending in `*` is a [wildcard](#wildcards-names-not-known-in-advance).                                                                         |
| `instructions`                | The names of the system-prompt sections it may contribute (`Contributions.instructions[].name`), by exact name: no `*`, no duplicates, and not `baseInstructions`, which is reserved for the replacement base (the app uses it to omit the replacement). A declared name may go unused. Contributing any needs the `system-prompt:extend` grant; see [`system-prompt:extend`](#the-system-prompt-grants). |
| `grants`                      | Optional. `<noun>:<verb>` capabilities (lowercase kebab parts, one colon, no duplicates) it asks of the host's per-extension services; see [`grants`](#grants).                                                                                                                                                                                                                                           |
| `emits`, `serves`             | `emits` is enforced (see below); `serves` is reserved.                                                                                                                                                                                                                                                                                                                                                    |

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
build one value per extension, and each declares the grants it understands; an extension's
manifest declares the grants of the services it provides ([`services.grants`](#servicesgrants)).
The host's **catalogue** is the union of both (a plain `hostService` value declares none). At
activation the host fails an extension, before its `activate` runs, with an `ExtensionGrantError`
naming the extension and the grant when:

- a grant is in no catalogue entry (a typo fails, and so does a grant of a service the app did not
  supply or no loaded extension provides), or
- a grant belongs to a service the extension cannot read, that is, not in its `services.requires`
  or `services.optional`.

Each service then enforces its own grants per method: the factory receives `{ name, manifest }`
and every method calls `requireGrant({ extension, grants, grant })`
(`@sheavly/extension/extension/grants.utils`), which throws an `ExtensionUndeclaredError`
(`use: 'grant'`, naming the grant, to be added to `grants`). A grant is a declaration the host
checks, not a sandbox: see [what the manifest is not](#what-the-manifest-is-not).

## `services.grants`

`services.grants` maps a service name this extension **provides** to the grants that service
understands, so the grants of an extension's own service are as visible as a host service's:

```json
"services": { "provides": ["sub-agents"], "grants": { "sub-agents": ["sub-agent:share"] } }
```

It is optional (absent means none). Each list follows the rule of `grants` (`<noun>:<verb>`, lowercase
kebab parts, one colon, bounded, no duplicates), a key must be in `provides` (the problem points
at `services.grants.<name>`), and a grant the host offers itself (the
[system-prompt grants](#the-system-prompt-grants)) cannot be claimed by a service. A grant may be
offered by two services. Like all of the manifest it is data: an installer reads it before any
code runs.

What the host does with it:

- Its catalogue lists every such grant for every loaded extension, before anything activates, so a
  consumer's `grants` entry verifies even when the provider is skipped (untrusted, a missing
  dependency); the consumer then reads the service as missing, like any service nobody provides.
- A consumer that lists the grant must list the service in `services.requires` or `optional`,
  with the same `ExtensionGrantError` as for a host service.
- The provider must provide a service that declares grants with `services.provideFor`, which hands
  `create` the consuming extension (its name, sealed manifest and live `contributedTools`);
  `services.provide` for it fails the provider's activation with an `ExtensionDefinitionError`
  ([services](services.md#services-an-extension-provides-per-consumer)).

What stays the provider's: **enforcement**. The host builds the scope per consumer, but it cannot
check that the provider's methods check the right grant, or any. The provider's methods call
`requireGrant` over `consumer.manifest.grants`, and review covers that they do.

## The system-prompt grants

Two grants belong to no service: the host offers them itself, so the catalogue always holds them
(`grantCatalogueOf` lists them under `HOST_PROVIDER`), a manifest that lists one never fails with
"no service offers it", and it need not list a service for it. Listing one while contributing
nothing is fine. Each covers only its own contribution; neither implies the other. Both strings
are defined once, in `@sheavly/extension/instructions/instructions.constants`
(`SYSTEM_PROMPT_EXTEND_GRANT`, `SYSTEM_PROMPT_REPLACE_GRANT`).

- **`system-prompt:extend`** lets the extension contribute `instructions: [{ name, text }]`, named
  in the manifest's `instructions` (never `baseInstructions`: that name is reserved for the
  replacement, so the app's omit label means one thing). Without the grant, an extension that returns any section fails
  its activation with an `ExtensionUndeclaredError` (`use: 'grant'`, naming the extension and the
  grant), like a service method called without its grant. An empty list needs no grant.
- **`system-prompt:replace`** lets the extension contribute `baseInstructions: string`, which
  replaces the generic base of the system prompt and nothing else: other extensions' sections and
  the app's own `instructions` still follow it. It has no manifest name list (it is one slot), but
  without the grant, activation fails the same way. At most one extension per run may hold it: a
  second one fails the run's merge with a `ContributionCollisionError` naming both, whichever
  activates first. When the app passes its own base explicitly, the app's base takes precedence
  over an extension's replacement; the app's explicit choice is not overridden. The app can also
  omit a section, or the replacement (by the reserved `BASE_INSTRUCTIONS_SECTION` name), with its
  `omitInstructionSections` option and always wins; the grant says what an extension may ask for,
  and the app still decides what reaches its prompt.

**These are the strongest grants an extension can ask for.** What an extension writes here IS the
system prompt: the model follows it as the harness's own instruction, ahead of anything the user
typed. The host checks only the shape of the text: a non-blank string of at most
`MAX_INSTRUCTION_CHARS` (4000) characters, read once and frozen
(`ExtensionInstructionError` otherwise, naming the extension, the section and the cap). It does
not and cannot check the **content**: that stays review-only. The host's own base prompt has a
recorded review that `npm run lint:prompt` checks; a text an extension contributes skips that
check, so an installer should read the section names and treat these grants as "may instruct the
model". A blank replacement is refused because it would silently drop the core guidance, which is
the app's choice and never an extension's.

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
- **Before activating, for `grants`**: each must be in the catalogue (the supplied services and
  every loaded extension's `services.grants`) and belong to a service the extension reads, else it fails (`ExtensionGrantError`, in `result.failed`,
  dependents skipped) without running `activate`. The two
  [system-prompt grants](#the-system-prompt-grants) are the host's own and need no service. See
  [`grants`](#grants).
- **During `activate`**: `services.get` for a name not in `requires` or `optional`, `services.find`
  for one not in `optional` or `requires`, and `services.provide` or `provideFor` for one not in
  `provides` throw at the call (`provide` also throws for a service that declares grants). Services the host supplies are held to the same list: an extension that reads
  `session-info` must declare it, which is what lets an installer see it (and its grants).
- **After `activate` returns**: a contributed tool, hook or work kind not listed in `tools`,
  `hooks` or `workKinds` (exactly, or by a wildcard entry) fails the activation. The extension is deactivated (it had activated), its
  services are dropped and its dependents are skipped. The host reads each name once, keeps what
  it checked and merges only that; if the lists or a name changed before the merge (the extension
  keeps its references while others activate), the extension fails the same way, with an
  `ExtensionContributionChangedError`, and its dependents are rolled back too. The same holds for
  `events` (each `kind` must be listed exactly in `emits.events`) and `notices` (needs
  `emits.modelFacingNotices: true`, and each `topic` must start with `<extension>.`), whose lists
  the re-verification covers, and whose names collide like any other contribution.
- **After `activate` returns, for the system prompt**: each contributed instruction `name` must be
  listed in `instructions`, the manifest must list `system-prompt:extend` (any section) and
  `system-prompt:replace` (a `baseInstructions`), and every text must be a non-blank string of at
  most `MAX_INSTRUCTION_CHARS` characters, else the extension fails like any other undeclared
  contribution and none of its sections or base is merged. Each section is kept as the host's own
  frozen `{ name, text }` copy and `baseInstructions` as the string read once, so what the
  extension does with its objects afterwards changes nothing. Two sections with one name, or a
  second `baseInstructions`, collide (`ContributionCollisionError` naming both). Merged sections
  come out in activation order. A manifest that lists a prompt grant, or a name, it never uses is
  fine.
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
  by another route: no scoped service hands out `publish`, `queueNotice` or `publishTask`, but code that imports
  the runtime and obtains a registry could call them, skipping the declaration and naming any
  extension in the envelope, which is impersonation to the model (the registry refuses a malformed
  notice and caps the outbox, but does not check who it names). The sink is an option of the host,
  not a service, so an extension that only holds the emit capability cannot emit under another's
  name. Lint rejects the runtime import in an extension's source; review covers the rest. The
  `session` an emit names can be any session of the run, sub-agents included; it
  cannot cross conversations, because one registry serves one conversation.
- **The content of a system-prompt text is review-only.** The host enforces the grant, the
  declared name, the cap and that the text is a non-blank string; nothing checks what it says.
  Lint covers only where the text lives: `harness/prompt-location` requires a section's `text`
  and `baseInstructions` to come from a `*.prompt.ts`, with the gaps listed in
  [contributions](contributions.md) (`Object.assign({ name }, { text })`, a section array in a
  class field, `c.baseInstructions = '...'` on a `Contributions` variable, a `get text()`), which
  stay review-only. The recorded prompt review (`npm run lint:prompt`) covers the
  host's own base prompt, not text an extension contributes. The 4000-character cap applies to a
  replacement base too, so it cannot carry the host's own generic base (about 34 KB): it is meant
  for a short base, and an app that needs a long custom base sets `baseInstructions` itself.
  Section texts are frozen copies;
  tools, work kinds and hooks are not (next item).
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
  `share` needs the grant `sub-agent:share` in the manifest's `grants` (the agents extension
  declares it for `sub-agents` in its `services.grants`), and the service in `requires` or
  `optional`: an installer reads that grant as the right to put tools and hooks in every
  sub-agent. Without it `share` throws an `ExtensionUndeclaredError` (`use: 'grant'`). The service
  is write-only: `share` copies the lists and validates each entry (an object with a non-empty
  string `name`, no duplicate), but does not freeze the tool and hook objects, which are held by
  reference. The shared lists cannot be read or changed through the service. What an extension
  shared is taken back when its scope is disarmed (it failed after sharing, was rolled back or
  stopped, or `agents` stopped): sub-agents started afterwards do not get it, sub-agents already
  running keep what they were given. What the host does not check is the shared names against
  the sharer's own `tools` and `hooks`: they are a service call, not a contribution.
- **Grants are global strings, not per service.** A grant name is one entry in the host's
  catalogue; the catalogue does not record which service it belongs to. Two providers may declare
  the same grant name, and a consumer that lists it and requires either service verifies. That is
  no bypass: reading each service still needs its own `requires`, and each provider enforces its
  own methods. Name a grant after the provider's capability (`<noun>:<verb>` with a noun that
  names it: `sub-agent:share`, not `share:use`), so one grant does not read as the right to
  something else.
- **The consumer a factory receives is a frozen snapshot.** `create(consumer)` of a host or an
  extension service gets one `Object.freeze`d `{ name, manifest, contributedTools }` per
  extension, the same object the extension holds when it reads its own service. It cannot be
  renamed or have `contributedTools` replaced, so a scope never reads the identity or the vouched
  tool names of another extension; `contributedTools()` still answers live.
- **A throwing `disarm` is contained and reported.** A service instance's `disarm` should not
  throw; if it does, the host keeps going (every other scope is still disarmed, every
  extension's `deactivate()` still runs) and the error comes back in the list `deactivate()`
  returns, or in `lateDeactivationErrors` when it happens while activating, or, when the
  activation fails, from the next `deactivate()`. A `disarm` that returns a promise is not
  awaited: its rejection is collected best-effort when it settles (possibly after the stop
  returned). A `disarm` that hangs synchronously blocks `deactivate()` for every extension.
- **The `services` an extension receives is a plain object.** Each extension gets its own view
  (`get`, `find`, `provide`, `provideFor`), not frozen: an extension can replace its own `get`,
  but it cannot reach another extension's view, and what the host checks (the declared use, the
  readable providers) does not run through that object.
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
