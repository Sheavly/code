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

The harness's run state reaches extensions this way: `@sheavly/host` has `runServices`, which turns
a harness into host services (`PROVIDER`, `SESSIONS`, `TASKS`, `APPROVALS` and the rest), so a
built-in extension has no more access than a third-party one. See
[run services for extensions](../../host/docs/harness.md#run-services-for-extensions).

Run services are not a sandbox: `PROVIDER`, `SESSIONS`, `TASKS` and `OUTPUTS` are full trust, and
an extension that reads one can act as the run (only `APPROVALS` is narrowed, to `request`). The app
decides which services it supplies (`runServices` returns a list it can filter) and which
extensions it loads; the host's only policy is the `origin: 'project'` trust gate, and `origin` is
declared by whatever loads the extension, not by the extension. A loader for repo code (#332) must
set `origin: 'project'` itself and should supply narrowed services.

## The app

The app that composes the run is no extension, so it depends on none: `host.service(KEY)` reads a
service the host supplied or any activated extension provided, and throws when none did.
