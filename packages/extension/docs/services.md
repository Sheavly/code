# Services

Services are not contributions: they are how one extension hands a typed value to the ones that
depend on it.

## Keys

`defineService<T>(name)` makes a `ServiceKey<T>`, a name with a phantom type. Export the key from
the providing extension's utils so both sides share it.

## Providing and reading

In `activate`, `context.services.provide(KEY, value)` makes the value available and
`context.services.get(KEY)` reads one. Each extension gets its own view of the registry
(`ServiceRegistry.viewFor`):

- It declares every service in its manifest ([manifest](manifest.md)): `services.requires` for
  what it reads with `get` (it is not activated without them: the host skips it with the reason
  `service`), `services.optional` for what it reads with `find`, `services.provides` for what it
  provides. `get` or `find` of a name in neither `requires` nor `optional`, or `provide` of one
  not in `provides`, throws an `ExtensionUndeclaredError`. Services the host supplies are held to
  the same declaration.
- It may read only services of itself and of the extensions it depends on, directly or not
  (`readableServices`). Reading one from an extension it does not depend on throws a
  `MissingServiceError` telling it to add the dependency, so activation order, not luck, decides
  what exists.
- `context.services.find(KEY)` is `get` for an optional service: `undefined` when nobody provides
  it. For a service provided by an extension it does not depend on, `find` returns `undefined`
  until that extension has activated and throws afterwards, so its answer is order-dependent for
  non-dependencies: an extension should `dependsOn` what it `find`s.
- Two extensions providing one key throw a `ContributionCollisionError` naming both.
- The services of an extension whose `activate` threw are dropped, so nothing reads a half-built
  extension.

## Services the host supplies

The app can supply run-level services (sessions, tasks, …) that any extension reads without a
dependency. `hostService({ key, value })` makes one and `ExtensionHostOptions.services` takes the
list. The registry records them under the reserved provider `<host>`, which cannot be an extension
name (those are kebab-case). An extension that tries to `provide` a key the host supplies fails
with a `ContributionCollisionError` naming "the host" and the extension, and two host services
with one name collide too.

### Per-extension services (factories)

`hostServiceFor({ key, grants, create })` supplies a service built per extension, so each gets a
value limited to what its manifest `grants`. `create({ name, manifest })` receives the extension's
name and the sealed, deep-frozen manifest the host holds, and returns `{ value, disarm? }`. The
registry calls it lazily, after the declared-use check has passed (a name not in `requires` or
`optional` still throws `ExtensionUndeclaredError`), and memoises per extension: one extension
reads the same instance every time, two extensions get distinct ones, so ownership sets can live
in the value. It never runs for `provide`. `host.service(key)` (the app's read) rejects a factory
service, since the app has no manifest. `create` may return `undefined` when the run has nothing to
give (an output store the app does not have): the service then reads as not provided, so `find`
answers `undefined` and `get` throws `MissingServiceError`, while its `grants` stay in the
catalogue and a manifest that asks for them still activates. The check that skips an extension
requiring a missing service builds the instance for it (the same one a later read gets), so one
whose factory returns `undefined` is skipped with reason `service` and `missing`, never activated
to fail at `get`.

The host calls each instance's `disarm` wherever it disarms the extension's emitter: `deactivate()`
(before any extension deactivates), a roll-back, a collision or abort, a failed activation and an
extension that finished after the host closed. It runs once, must not throw, and a value read
after it is born disarmed. What a disarmed value does (the scopes throw `deactivated`) is the
service's own. `grants` is the list the host builds its grant catalogue from (see
[manifest](manifest.md#grants)); plain `{ name, value }` entries keep working and declare none.
`requireGrant` (`@sheavly/extension/extension/grants.utils`) is the one check a scope method makes.

The harness's run state reaches extensions this way: `@sheavly/host` has `runServices`, which turns
a harness into scoped host services (`SESSION_INFO`, `CHILD_SESSIONS`, `BACKGROUND_TASKS`, `APPROVALS` and the rest), so a
built-in extension has no more access than a third-party one. See
[run services for extensions](../../host/docs/harness.md#run-services-for-extensions).

Run services are least privilege, not a sandbox: each is narrow and checks the grants the
extension declares, but an extension is Node code and can still use `fs`, `fetch` and
`child_process`, or import runtime classes. The app decides which services it supplies
(`runServices` returns a list it can filter) and which extensions it loads; the host's only policy
is the `origin: 'project'` trust gate, which gates loading and is read by no service, and `origin`
is declared by whatever loads the extension, not by the extension. A loader for repo code (#332)
must set `origin: 'project'` itself.

## The app

The app that composes the run is no extension, so it depends on none: `host.service(KEY)` reads a
service the host supplied or any activated extension provided, and throws when none did.
