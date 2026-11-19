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
- Two extensions providing one key (`provide` or `provideFor`) throw a
  `ContributionCollisionError` naming both.
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
extension that finished after the host closed. It runs once and should not throw (if it does, the host contains the error
and reports it: see below), and a value read after it is born disarmed. What a disarmed value does (the scopes throw `deactivated`) is the
service's own. `grants` is the list the host builds its grant catalogue from (see
[manifest](manifest.md#grants)); plain `{ name, value }` entries keep working and declare none.
`requireGrant` (`@sheavly/extension/extension/grants.utils`) is the one check a scope method makes,
for a host service and for [one an extension provides](#services-an-extension-provides-per-consumer).

### Where the run-service keys live and how an extension imports them

The keys of the services the host supplies are in this package, so an extension imports the
contract and the keys from `@sheavly/extension` alone:

```ts
import { BACKGROUND_TASKS, SESSION_INFO } from '@sheavly/extension/run-services/run-services.utils';
import type { BackgroundTaskScope } from '@sheavly/extension/run-services/run-services.types';
```

`run-services.utils` holds `INSTRUCTIONS` (`instructions`), `MAIN_SESSION` (`main-session`),
`APPROVALS` (`approvals`), `SESSION_INFO` (`session-info`), `CHILD_SESSIONS` (`child-sessions`),
`BACKGROUND_TASKS` (`background-tasks`), `TASK_CONTROL` (`task-control`), `OUTPUT_READER`
(`output-reader`), `OUTPUT_CAPTURE` (`output-capture`) and `MODEL` (`model`). The name is what a
manifest lists in `services.requires` or `optional`, so it is a contract: a test pins each one.
The doc comment of each key says which grants apply. A service matches by name, not by key object.

`run-services.types` defines `ApprovalRequester`, `ExtensionApprovalRequest` and
`SystemPromptView`, and re-exports as types the views the keys carry, which the runtime and core
define: `SessionInfoView`, `SessionLifecycleUpdate`, `ChildSessionScope`, `RunChildParams`,
`RunChildResult`, `BackgroundTaskScope`, `TaskStarter`, `TaskControl`, `OutputReader` and
`OutputCapture`. They are imported with `import type`, so the package depends on
`@sheavly/runtime` for types only. The values are still made by `@sheavly/host`. A
`ScopeDeactivatedError` (`@sheavly/extension/errors/scopes.errors`) is what a scope throws when it
is used after its extension stopped.

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

## Services an extension provides per consumer

`provide(key, value)` hands every reader one shared value, so the provider cannot know who calls
it. A service that must limit what each caller may do is provided with
`services.provideFor({ key, create })`, the extension counterpart of `hostServiceFor`:
`create(consumer)` receives the consuming extension (`ServiceConsumer`: its `name`, its sealed
manifest and a live `contributedTools()`) and returns `{ value, disarm? }`. The consumer is a
frozen snapshot the host makes once per extension (`Object.freeze`, `contributedTools` closed
over the extension's name): a provider that reads its own key holds the same object, so it
cannot rename it to read another extension's scope or widen what `contributedTools()` vouches
for. A scope that keeps the consumer can trust `consumer.name` for as long as it lives.

```json
{ "services": { "provides": ["sub-agents"], "grants": { "sub-agents": ["sub-agent:share"] } } }
```

```ts
services.provideFor({
  key: SUB_AGENTS,
  create: (consumer) => ({
    value: {
      share: (tools) => {
        requireGrant({
          extension: consumer.name,
          grants: consumer.manifest.grants,
          grant: 'sub-agent:share',
        });
        // ...
      },
    },
  }),
});
```

- **Per consumer, lazily, once.** The host calls `create` on a consumer's first `get` or `find` of
  the key, after the declared-use check, and memoises it: the same consumer reads the same value
  every time, two consumers get distinct ones. It is never called for an extension that does not
  depend on the provider (that read throws `MissingServiceError`), nor for `provide`. A provider
  that reads its own key is a consumer like any other, built for its own manifest. An extension
  cannot list its own service in `requires` (it would be skipped before it can provide it), so it
  reads it with `optional` and `find`. The app's `host.service(key)` rejects such a service, as
  it does a host factory.
- **Grants are declared in the manifest.** `services.grants` maps a service the extension
  provides to the grants it understands ([manifest](manifest.md#servicesgrants)). A consumer
  lists one in its `grants` and the service in `services.requires` or `optional`; the host checks
  that before any code runs, like a host service's grants. If the provider is skipped (not
  trusted, a dependency missing) its grants stay known, so a consumer's manifest still verifies
  and the service then reads as missing like any service nobody provides.
- **A service with declared grants must use `provideFor`.** `provide` for such a key throws an
  `ExtensionDefinitionError` naming the extension, the service and the fix, which fails the
  provider's activation. `provideFor` for a service with no declared grants is allowed. A key not
  in `services.provides` is refused as `provide` refuses it (`ExtensionUndeclaredError`), and a
  key another extension or the host already provides throws a `ContributionCollisionError`
  naming both, whichever of `provide` and `provideFor` each used.
- **The provider enforces.** The host calls `create` with the consumer and nothing else: the
  service's methods check the right grant with `requireGrant` over `consumer.manifest.grants`
  (the `ExtensionUndeclaredError` with `use: 'grant'` names the consumer and the grant). The host
  cannot check that a provider's methods check the right grant, or any at all: that is the
  provider's code, and review is what covers it. What a test can prove is each call: a provider's
  test calls `assertServiceEnforcesGrants({ provider, service, calls })`
  (`@sheavly/extension/testing/service-grants.fake`, with `services` and `alongside` for what the
  provider reads) with one call per grant its manifest declares for the service. For each grant it
  runs a real host with a consumer that holds every other declared grant, and the call must throw
  the undeclared-grant error naming that consumer and grant; with the grant held it must not. It
  fails when `calls` lacks a declared grant or names one the provider does not. It proves each
  listed call refuses without its grant, not that the list covers every method of the service. For
  an extension in `extensions/*` the eslint-config tests require such a call.
- **Disarm follows both ends.** A `disarm` returned by `create` runs once when the host disarms
  the consuming extension (`deactivate()`, a roll-back, a failed activation, a skip, an extension
  that finished after the close) and also when the providing extension enters a final state, so a
  scope never outlives its provider. A value read after either end is born disarmed. It should
  not throw, and if it does the host contains it: the instance still counts as ended once, every
  other instance is still disarmed, every extension's `deactivate()` still runs and the state
  table still completes its moves. The errors are collected and reported with the others: in
  the list `deactivate()` returns, or, when the disarm ran during activation (a failed or
  rolled-back extension), in the result's `lateDeactivationErrors`. `activate()` does not reject
  because of it. When the activation itself fails (a collision, an abort) the thrown error is
  unchanged and what the closing contained is returned once by the next `deactivate()`.
  A `disarm` that returns a promise is not awaited, so a hang there cannot block the stop; its
  rejection is collected best-effort, when it settles, and returned by the next `deactivate()`
  that runs after that (it can be the same call or a later one). An app that calls
  `deactivate()` once, as the backend does, therefore hears a rejection that settles within the
  stop (an `async` function that throws) and never one that settles later, after a timer or other
  I/O: write a `disarm` so that it does not reject. A `disarm` that hangs synchronously blocks
  `deactivate()` for every extension: the host cannot interrupt it.

Like every grant, this is least privilege, not a sandbox: a consumer is Node code and the
provider's check only covers what goes through the service.

## The app

The app that composes the run is no extension, so it depends on none: `host.service(KEY)` reads a
service the host supplied or any activated extension provided, and throws when none did.
