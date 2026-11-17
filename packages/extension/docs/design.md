# Design

`@sheavly/extension` is the one place the extension lifecycle lives: the contract extensions are
written against, and the host an app uses to run them. It is generic and depends on `@sheavly/core`
only (it needs `Tool` and `Hook` for what an extension contributes). Extensions and apps depend on
it; core and `@sheavly/host` know nothing about extensions. The rules an extension author follows
are in the `sheavly` skill's `extensions.md`; this page is how the package is built.

## Two halves

- **The contract** (`extension/`, `errors/`): `Extension`, `Contributions`, `Services`,
  `Settings`, `ServiceKey` and `SettingKey` (types), `defineExtension`, `defineService`,
  `hostService`, `defineSetting` and `placeHook` (utils) and the typed errors. `defineExtension`
  is an identity helper that rejects a bad name, a self-dependency and a repeated dependency when
  the extension is defined, so a mistake fails at startup.
- **The host** (`host/`): `ExtensionHost` is a service that owns one session's state. Its helpers
  are pure: `orderExtensions` (the graph), `readableServices` (who may read what),
  `mergeContributions` (collision-checked merge), `orderHooks` (hook placement) and
  `assertSettings` (the user's setting values); `ServiceRegistry` holds the shared services.

## No category, no policy

The framework imposes nothing on what an extension is: it has no kind or domain, and the host
does not decide which extensions suit a run. An extension defines what it can and cannot do
itself, through what it depends on, declares and checks in its own `activate`. Others build
extensions without changing this source.

## Why a contribution never owns the loop

An extension adds tools, hooks and work kinds; it never replaces a core module. The host
adds nothing of its own to the loop: it returns the merged lists and the app passes them on.
Two contributions of one kind with one name throw a `ContributionCollisionError` naming both
extensions, so nothing shadows anything. Settings are not contributions but static declarations,
so the host can validate the user's values before anything activates (see
[contributions](contributions.md)).

## Extending

- A new kind of contribution: add it to `Contributions` and a collision-checked list to
  `mergeContributions`, plus a `ContributionKind` for its messages.
- A new failure the host should report instead of throw: add a step kind in
  `extension-host.service.ts` and a field on `ActivationResult`.
- Tests use `fakeExtension`, `fakeHook` and `fakeTool` (`testing/`); they are not public API of
  the built package, only of the workspaces' tests.

See [lifecycle](lifecycle.md) for the order of events, [services](services.md) for sharing and
[contributions](contributions.md) for settings and hook order.
