# Extensions

Part of #102 (make the harness extendable the way VS Code is): a run is built from extensions,
and `coding` is the first one, not a special case. Read this before adding an extension, changing
the contract, or touching `extensions/`.

## What an extension is

An `Extension` (`@sheavly/extension/extension/extension.types`) has a unique kebab-case `name`, an
optional `origin` (`builtin`, or `project` for code from the user's repo), `dependsOn` (extension
names), optional static `settings` and `activate(context)`, which returns its contributions.
`deactivate()` runs once when the session ends. Write one with `defineExtension`.

A contribution adds to the loop and never owns it. It can be:

- `tools` and `hooks` (an instruction source is a hook: `createInstructionHook`); a hook can say
  where it goes with `placeHook({ hook, before, after })`;
- `workKinds`, a declared kind of background work (name and whether it is `finite` or a
  `service`); the work itself still starts through `startWork` ([sessions-and-background-work.md](sessions-and-background-work.md)).

Services are not contributions: an extension shares a typed service (`defineService<T>(name)`)
with `context.services.provide(KEY, value)`, and the ones that depend on it read it with
`context.services.get(KEY)` (or `find(KEY)` when it is optional). Reading a service from an
extension you do not depend on throws, so activation order, not luck, decides what exists; `find`
of such a service returns `undefined` until that extension has activated and throws afterwards,
so `dependsOn` what you `find`. The
app can also supply run-level services (`hostService`, `ExtensionHostOptions.services`) that every
extension reads without a dependency.

Settings are declared, not contributed: `defineSetting({ name, description, default })` makes a
typed key listed in `Extension.settings`, and `context.settings.get(KEY)` returns the user's value
or the default.

## Rules

- **The framework imposes no category or policy on extensions.** There is no kind, domain or
  preset an extension must fit: each defines what it can and cannot do itself, so others can build
  extensions without changing our source.
- **Names collide loudly.** Two tools, hooks, work kinds, settings or services with one name
  throw a `ContributionCollisionError` naming both extensions (or the host, for a service it
  supplies). Nothing shadows anything.
- **The host supplies run services any extension can read.** Sessions, tasks and the like come
  from the app as `hostService` values, readable without a `dependsOn`; an extension cannot
  provide a key the host supplies. The app builds them with `runServices`
  (`@sheavly/host/run-services/run-services.utils`, the one place they are made) from the
  harness: `PROVIDER`, `INSTRUCTIONS`, `SESSIONS`, `MAIN_SESSION`, `TASKS`, `APPROVALS` and
  `OUTPUTS` only when the app has an output store (read it with `find`). Start background
  work through `TASKS` with the work factories (`@sheavly/runtime/tasks/work.utils`) and ask the
  user through `APPROVALS`, which only requests: answering is the UI's. There is no environment
  service; configuration is a setting.
- **Run services are not a sandbox.** An extension is code that can already do whatever Node can;
  the services add the run's authority: `TASKS` (list, read the output of and cancel the run's
  other tasks), `OUTPUTS` (the complete output of every command, which can hold secrets),
  `PROVIDER` (model calls on the app's credentials) and `SESSIONS` (every session's events and
  approvals, messages sent as if from the user, ending sessions, publishing stream entries).
  `APPROVALS` only requests, but approvals still appear in the stream `SESSIONS` exposes. The app
  decides which services it supplies (`runServices` returns a list it can filter) and which
  extensions it loads; the host's only policy is the `origin: 'project'` trust gate (anything not
  `builtin` goes through it), and `origin` is declared by whatever loads the extension, not by
  the extension. A loader for repo code (#332) must set `origin: 'project'` itself and should
  supply narrowed services.
- **Built-in extensions get no more access than a third party.** `agents` and `web` take nothing
  from the app that another extension could not read from the same services; options are only
  the embedding app's choices (a provider selector, a summarizer). The one stated exception:
  `coding` reads its workspace, file locks and process runner from the `CodingHarness` it is
  given (built on `createHarness`, so it also carries the run state), and takes its own `env`
  option (working roots and home); it reads `OUTPUTS` from the services like anyone. A new built-in that needs
  something only the app's code can inject is a missing run service: add the key, not an option.
- **Settings are declared and read through the context.** `Extension.settings` lists
  `defineSetting` keys, `context.settings.get(KEY)` reads them, and the host validates the user's
  values at construction: a name nobody declares, a value of the wrong type or a name two
  extensions declare throws.
- **Hook position is declared with before/after.** `placeHook` names other hooks by `hook.name`;
  the host orders with a stable topological sort, ignores a name not in the run and throws a
  `HookOrderError` for a cycle. Hooks shared with sub-agents through `SUB_AGENTS.share` stay a
  plain list in the sharer's order.
- **Order is the dependency order.** `ExtensionHost` (`@sheavly/extension/host/extension-host.service`)
  activates each extension after what it depends on, otherwise in the order given, and
  deactivates in reverse. A missing dependency, a cycle or a repeated name throws an
  `ExtensionGraphError` at construction.
- **One failure does not stop the rest.** An `activate` that throws, or a trust check that throws,
  is reported in `result.failed`; the extensions that depend on it are `skipped` (`dependency`);
  the others activate. What the failed one provided as services is dropped. The caller decides
  whether that is fatal (the backend deactivates what activated, then throws).
- **A host lives one session.** It activates once (a second `activate` throws), an aborted signal
  or a `deactivate` while it activates stops the rest, and an extension whose `activate` threw is
  not deactivated: `activate` cleans up after itself before it throws. Share with another
  extension's scope (`SUB_AGENTS`) as the last step of `activate`: what is shared is not taken
  back, so a failure after it would leave tools behind.
- **Content needs no trust, code does.** A `project` extension is skipped (`untrusted`) unless
  the host's `isTrusted` says its code is trusted. Builtin extensions never ask. `origin` is a
  declaration by the app that loads the extension, not a check: an app that embeds code vouches
  for it, and only code it loads from a repo is declared `project`.
- **Extensions compose tools.** `harness/imports` bans a package's source from importing a
  `*.tool` module (a package never picks a run's tools); an extension's source may, since choosing
  and building tools is what it is for. An app still decides which extensions a run has.
- **Extend, don't modify.** A new behaviour is an extension. Editing the host, the loop or a
  registry to special-case one extension is the mistake.

## Where an extension lives

`extensions/<name>/` is a workspace of its own, a library of what a run includes, alongside
`packages/` (generic pieces) and `apps/` (front ends). It is built on packages, never the other
way round (`harness/layout` fails a package that depends on an extension), and an app composes
extensions. An extension may depend on another extension. Its public API is declared like a
package's (`exports` by file kind). Its workspace has a `sheavly.domain` like every workspace; that
is repo layout policy for the workspace graph, not part of the extension contract.

## Adding one

1. `npm run new -- extension <name> --domain <generic|coding> --description "…" [--depends-on core,host]`
   creates `extensions/<name>/` through npm; it refuses a dependency the graph doesn't allow.
2. Write `src/extension/<name>.helper.ts`: a `create<Name>Extension(options)` returning
   `defineExtension({ name, dependsOn, activate })` (see `extensions/coding`). Build
   tools and hooks in `activate` from the services it reads.
3. Give it a test that activates it through an `ExtensionHost` with a fake `Extension` beside it
   (`@sheavly/extension/testing/extension.fake`).
4. Include it where the run is built: the app (`createBackendHarness`) lists the extensions.
   No package adds an extension to a run.
5. Update its README and `docs/`, then `npm run graph` for the generated tables.

## Writing an extension without editing our source

Checklist for an extension that is not in `extensions/` and reaches the run only through
`createBackendHarness` and its `extensions` option. The packages are private workspaces and
`apps/backend/src/harness/__tests__/third-party-capabilities.test.ts` lives inside `apps/backend`,
so it shows what is reachable from the monorepo through public exports; publishing the packages
and installing an extension (a loader) are #332. It is the test to keep green when the contract
changes.

- Import only public subpaths: `@sheavly/extension/extension/extension.utils`
  (`defineExtension`, `defineService`, `defineSetting`, `placeHook`),
  `@sheavly/host/run-services/run-services.utils` (the keys), `@sheavly/runtime/tasks/work.utils`
  (background work) and `@sheavly/core/tool/tool.utils`. Never import `coding` or `agents`
  internals.
- A setting: declare it with `defineSetting` in `Extension.settings` and read it with
  `context.settings.get`; the user's value is `extensionSettings`.
- A hook position: `placeHook({ hook, before: ['agents-md'] })` or `after`, by `hook.name`.
- A service of your own: `services.provide(KEY, value)`, and `dependsOn` the provider to read it.
- Background work: declare a `workKinds` entry and start it from a tool with `startWork` and
  `finiteWork` on `services.get(TASKS)`, owned by `context.session`.
- Asking the user: `services.get(APPROVALS).request(...)`; the UI answers, an extension cannot.
- The run's own state: `SESSIONS`, `MAIN_SESSION`, `PROVIDER`, `INSTRUCTIONS` and
  `services.find(OUTPUTS)` (absent without an output store). There is no environment service:
  read configuration through a setting.

## What is enforced, and what is not

Enforced: the workspace layout (`extensions/*` kind, packages never depend on extensions,
generic workspaces never on coding ones), the extension's public API, the host's collision,
order, settings, hook-order and trust tests. Review only: that `activate` does no work the
session did not ask for, and that a service key is not a way around an import boundary.

Out of scope, as in #102: hand-written manifests for code, lazy activation, a `when` language,
per-package trust and a marketplace. A CLI to install and manage extensions is #332.
