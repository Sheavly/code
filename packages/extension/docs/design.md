# Design

`@sheavly/extension` is the one place the extension lifecycle lives: the contract extensions are
written against, and the host an app uses to run them. It is generic and depends on `@sheavly/core`
only (it needs `Tool` and `Hook` for what an extension contributes). Extensions and apps depend on
it; core and `@sheavly/host` know nothing about extensions. The rules an extension author follows
are in the `sheavly` skill's `extensions.md`; this page is how the package is built.

## Two halves

- **The contract** (`extension/`, `manifest/`, `errors/`): `Extension`, `ExtensionDefinition`,
  `Contributions`, `Services`, `Settings`, `ServiceKey` and `SettingKey` (types),
  `defineExtension`, `defineService`, `hostService`, `hostServiceFor`, `requireGrant`,
  `settingKey` and `placeHook` (utils) and the typed errors. `defineExtension` takes the extension's manifest and its code, derives the `name`,
  `dependsOn` and settings from the manifest and validates the manifest again, so a bad name, a
  self-dependency or a repeated name fails when the extension is defined, at startup. The manifest
  itself (`manifest/`) is a zod schema (`manifest.validator.ts`, the one place those rules live),
  the types inferred from it and `readManifest`, the only file system access in the package (see
  [manifest](manifest.md)).
- **The host** (`host/`): `ExtensionHost` is a service that owns one session's state. Its helpers
  are pure: `orderExtensions` (the graph), `readableServices` (who may read what),
  `mergeContributions` (collision-checked merge), `orderHooks` (hook placement),
  `assertSettings` (the user's setting values) and `snapshotContributions` (what an extension
  contributed against its manifest, recording the names that were checked so the merge uses only
  those and re-verifies them);
  `sealExtension` (`extension/`) gives the host one deep-frozen copy of each manifest; `ServiceRegistry` holds the shared services (building a factory
  service lazily, once per extension, and disarming those instances with the emitter) and holds
  each extension's reads and provides to its manifest; `grantCatalogueOf` and
  `assertGrantsOffered` verify a manifest's `grants` against the supplied services plus the two
  the host offers itself (`system-prompt:extend`, `system-prompt:replace`, defined once in
  `instructions/instructions.constants.ts`).

## Pure helpers an extension shares with the host

For these two helpers an extension no longer needs `@sheavly/host`: the package holds them, pure,
and the host's behaviour builds on them:

- `joinInstructions` (`instructions/instructions.utils`): joins instruction sections, each trimmed,
  blank or missing ones dropped, a blank line between. The host's `composeInstructions` and
  `composeSystemPrompt` build on it and add the generic base prompt, which stays in
  `@sheavly/host`; an extension contributes sections and the host composes them.
- `keepsFit`, `MAX_REQUEST_KEEPS` and `MAX_KEEP_ENTRY_CHARS` (`approval/`): the limits the host's
  approvals scope enforces on the `keeps` of a request (`approval:keep`). An extension that
  proposes entries it computed itself asks `keepsFit` first and, when they do not fit, asks without
  keeping anything. The host's scope imports the same definition, so the limits live in one place.

The service keys still come from `@sheavly/host/run-services/run-services.utils` and the scope
views from the runtime: this package sits below the runtime in the graph, so it cannot hold them.

## No category, no policy

The framework imposes nothing on what an extension is: it has no kind or domain, and the host
does not decide which extensions suit a run. An extension defines what it can and cannot do
itself, through what it depends on, declares and checks in its own `activate`. Others build
extensions without changing this source. What the host does ask is that an extension says what it
needs and does in its manifest, and does no more: that is how something can read an extension
without running it.

## Why a contribution never owns the loop

An extension adds tools, hooks, work kinds and system-prompt sections (`instructions`, and the one
replacement `baseInstructions`, each behind its own host-offered grant, checked in
`instruction-check.utils.ts`), and declares the event kinds and notice topics it
may emit (`events`, `notices`; it sends them through `context.emit`, built per extension, to a sink
the app supplies, and the host disarms it when the extension stops; the sink is not a service, but
no scoped service hands out `publish`, `queueNotice` or `publishTask`, though Node code could reach a registry by importing the runtime); it never replaces a core
module. The host
adds nothing of its own to the loop: it returns the merged lists and the app passes them on.
Two contributions of one kind with one name throw a `ContributionCollisionError` naming both
extensions, so nothing shadows anything. Settings are not contributions but static declarations
in the manifest, so the host can validate the user's values before anything activates (see
[contributions](contributions.md)).

## What the host does not guarantee

Item objects (tools, work kinds, hooks) are kept as the extension returned them and are not
frozen. The host records and merges the names it checked and re-verifies them, with the lists,
synchronously right before the merge; a getter that changes what an object does or says after the
merge is the extension's own responsibility, since an extension is Node code. Likewise
`readManifest` stats a file and then reads it: a path swapped for a FIFO between the two can
block the read, which needs write access to the extension's own directory (see
[manifest](manifest.md#what-the-manifest-is-not)).

## Extending

- A new kind of contribution: add it to `Contributions` and a collision-checked list to
  `mergeContributions`, plus a `ContributionKind` for its messages.
- A new failure the host should report instead of throw: add a step kind in
  `extension-host.service.ts` and a field on `ActivationResult`.
- A new field of the manifest: add it to the schema in `manifest.validator.ts`, rerun
  `npm run schema -w @sheavly/extension`, and enforce it in the host or say in
  [manifest](manifest.md) that it is reserved (`serves` still is; `emits` is enforced).
- Tests use `fakeExtension`, `fakeHook`, `fakeTool` and `fakeSetting` (`testing/`); `fakeExtension`
  builds an in-memory manifest from what the test declares. They are not public API of the built
  package, only of the workspaces' tests.

See [manifest](manifest.md) for the file, [lifecycle](lifecycle.md) for the order of events, [services](services.md) for sharing and
[contributions](contributions.md) for settings and hook order.
