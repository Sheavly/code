# Extensions

Part of #102 (make the harness extendable the way VS Code is): a run is built from extensions,
and `coding` is the first one, not a special case. Read this before adding an extension, changing
the contract, or touching `extensions/`.

## What an extension is

An `Extension` (`@sheavly/extension/extension/extension.types`) has a unique kebab-case `name`, an
optional `origin` (`builtin`, or `project` for code from the user's repo), `dependsOn` (extension
names), optional static `settings` and `activate(context)`, which returns its contributions.
`deactivate()` runs once when the session ends. Write one with
`defineExtension({ manifest, origin?, activate, deactivate? })`: the `name`, `dependsOn` and
settings come from its manifest, never from the call.

## The manifest: `sheavly.json`

Every extension ships a strict-JSON `sheavly.json` at its workspace root
(`extensions/<name>/sheavly.json`): the single source for its `name`, `dependsOn` and settings,
and a declaration of the services, tools, hooks and work kinds it uses. It is data, so an
installer can read what an extension asks for before running its code. The full field list, the
errors and the JSON Schema are in `packages/extension/docs/manifest.md`; the shape is:

```json
{
  "$schema": "../../packages/extension/sheavly.schema.json",
  "name": "notes",
  "dependsOn": ["files"],
  "services": { "requires": ["sessions"], "optional": ["outputs"], "provides": ["notes-store"] },
  "settings": [{ "name": "notes.max-notes", "type": "number", "default": 50, "description": "…" }],
  "tools": ["add_note"],
  "hooks": ["notes-instructions"],
  "workKinds": ["notes.sync"],
  "emits": { "events": ["notes.progress"], "modelFacingNotices": true }
}
```

- Only `name` is required; unknown keys are rejected at every level, so a typo fails. The file
  is strict JSON (`JSON.parse`, no comments).
- An extension reads its own from its helper, two levels below the workspace root in `src/` and
  in `dist/`, and builds itself from it:

  ```ts
  const manifest = readManifest(new URL('../../sheavly.json', import.meta.url));

  export const notes = defineExtension({ manifest, activate });
  ```

  `readManifest` is `@sheavly/extension/manifest/manifest.helper`; it throws an
  `ExtensionManifestError` naming the file and every problem.

- A typed setting key refers to a manifest entry:
  `settingKey({ manifest, name: 'notes.max-notes', type: 'number' })` carries the manifest's
  default and description, and throws when the manifest does not declare that name and type.
- **A name not known in advance** (a workspace's own hook files) is a wildcard entry in `tools`,
  `hooks` or `workKinds`: a trailing `*` once, as the last character (`"project-hooks.*"`); a bare
  `"*"` is for `hooks` only. Prefer a prefix.
- `emits` is enforced (see "Emitting events and notices" below). `serves` is reserved:
  validated, not enforced, because actions don't exist yet.

### What the host does with it

The host holds an extension to its manifest and fails loudly, naming the extension and the name:

- **Before activating**, each `services.requires` name must be readable (supplied by the host or
  provided by a dependency). If not, the extension is `skipped` with the reason `service` and the
  `missing` names, and what depends on it is skipped for `dependency`.
- **During `activate`**, `services.get` of a name not in `requires`/`optional`, `services.find`
  of one not in `optional`/`requires`, and `services.provide` of one not in `provides` throw.
  Services the host supplies (`sessions`, `outputs`) must be declared too.
- **After `activate`**, a contributed tool, hook or work kind not declared in `tools`, `hooks` or
  `workKinds` (exactly, or by a wildcard) fails the activation: the extension is deactivated and
  its dependents skipped. A declared name may go unused (some tools exist only under options).
  The host reads each name once, merges by the recorded names and re-verifies lists and names
  right before the merge: one that changed after the check fails the extension too
  (`ExtensionContributionChangedError`). Item objects are not frozen, so what a getter does
  after the merge is the extension's own responsibility (see "What the manifest is not" in
  `packages/extension/docs/manifest.md`).

- **After `activate`, for emits**: each contributed event `kind` must be listed exactly in
  `emits.events`, and a contributed notice needs `emits.modelFacingNotices: true` and a `topic`
  in the extension's own namespace; the same re-verification and collision check apply.
- **At each emit**: see "Emitting events and notices".

Both land in `result.failed` as an `ExtensionActivationError` whose `cause` is the
`ExtensionUndeclaredError` (or the changed-contribution one). The host's own checks cannot be
switched off: a test that contributes something declares it (`fakeExtension` builds the manifest
from what the test says). The host works from one deep-frozen copy of each manifest.

**What the manifest is not** (the full list is in `packages/extension/docs/manifest.md`): an
extension is Node code and can use `fs`, `child_process`, `fetch` and `process.env` without
declaring them; the manifest declares only what the host mediates (services, merged
contributions, settings), a wildcard (coding's bare `*` for hooks) makes a declared set
open-ended, a service matches by name and not identity, and a required service from an extension
it does not `dependsOn` skips the extension. Declaring the `sub-agents` service (the agents
extension provides it) in `requires` grants the right to share tools and hooks with sub-agents
without those names appearing in the extension's own `tools` or `hooks` (`share` is a service
call, not a contribution): an installer should treat it as that grant.

A contribution adds to the loop and never owns it. It can be:

- `tools` and `hooks` (an instruction source is a hook: `createInstructionHook`); a hook can say
  where it goes with `placeHook({ hook, before, after })`;
- `workKinds`, a declared kind of background work (name and whether it is `finite` or a
  `service`); the work itself still starts through `startWork` ([sessions-and-background-work.md](sessions-and-background-work.md));
- `events` and `notices`, the kinds and topics it may emit, each with the schema of its `data`.

### Emitting events and notices

An extension tells a UI or the model something with `context.emit`, never by editing the
protocol's closed unions and never by importing `@sheavly/runtime` to publish. Declare it in
`sheavly.json` (`emits: { events: ['notes.progress'], modelFacingNotices: true }`), return
`events: [{ kind, version, schema }]` and `notices: [{ topic, version, schema }]` from `activate`
(zod schema for `data`), then call `emit.event({ kind, data, text, session? })` or
`emit.notice({ topic, data, text, session? })` once activated (from a tool, a hook or background
work; a tool passes `context.session`, the default is the main session).

- **Everything an extension needs to emit comes through `@sheavly/extension`**: the `emit`
  capability, the contribution types, the envelope types (`ExtensionEvent`, `ExtensionNotice`,
  `ExtensionEmission`) and the sink type, from `@sheavly/extension/emit/emit.types`. The app
  supplies only a sink (`ExtensionHostOptions.emit`, wired in `createBackendHarness`); it is an
  option of the host, not a run service, so an extension that only holds the emit capability
  cannot emit under another's name (the `sessions` service is a bypass: see below).
- **The host checks at each emit**: the kind or topic is one this extension contributed and
  declared (`ExtensionUndeclaredError` for one the manifest does not declare, naming the
  extension), `version` is the contribution's, `data` parses against its schema (an
  `ExtensionEmitError` with issue paths, never the values; a schema or data that throws is the same
  error), the finished envelope parses with the protocol's own event or notice schema (name and
  namespace, version, `text` 1 to 2000 characters, serialized `data` at most 16384 bytes), and the
  host has a sink. Before `activate` has returned and been checked it throws "not activated yet";
  after the host stops, drops or fails the extension (`deactivate()`, a roll-back, a collision, a
  failed `activate`) it throws `deactivated`. A contribution whose name is not
  `<extension>.<name>` or whose version is not a positive integer fails the activation. The
  emitter is armed from the names and versions the host recorded, not the live objects.
- **The session** an emit names can be any session of the run, sub-agents included; it cannot
  cross conversations, because one registry serves one conversation. A session's outbox holds at
  most 100 notices; past that `emit.notice` throws, as it does for an ended session.
- **What it does not check**: it is a host-checked gate, not a sandbox. The extension is Node code
  and the `sessions` run service is the session registry itself: declaring `sessions` lets code
  `publish` or `queueNotice` by another route, bypassing the declaration and naming any extension
  in the envelope (impersonation to the model; the registry still refuses a malformed notice).
  Narrower services (#336) are where that closes; until then reading and review keep an
  extension on `emit`.
- **A UI never trusts a kind.** An event's `kind` is open: a UI that does not know it shows
  `text` (the terminal does, escaped as plain text) and never switches on `kind` to refuse. A
  notice reaches the model as `<harness-notice kind="extension-notice" extension="…">` with the
  `text` escaped and fenced as data; `data` never reaches the model. Events are not stored in
  history (they replay from the stream); notices are, and `notice` hooks never see them.

Services are not contributions: an extension shares a typed service (`defineService<T>(name)`)
with `context.services.provide(KEY, value)`, and the ones that depend on it read it with
`context.services.get(KEY)` (or `find(KEY)` when it is optional). Reading a service from an
extension you do not depend on throws, so activation order, not luck, decides what exists; `find`
of such a service returns `undefined` until that extension has activated and throws afterwards,
so `dependsOn` what you `find`. The
app can also supply run-level services (`hostService`, `ExtensionHostOptions.services`) that every
extension reads without a dependency.

Settings are declared, not contributed: they are listed in the manifest's `settings`,
`settingKey({ manifest, name, type })` makes the typed key, and `context.settings.get(KEY)`
returns the user's value or the default.

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
  `APPROVALS` only requests, but approvals still appear in the stream `SESSIONS` exposes. The
  emit sink is not a service, but `SESSIONS` can `publish` and `queueNotice` itself, so it bypasses
  the emit declaration and can name any extension in the envelope (#336 narrows services). The app
  decides which services it supplies (`runServices` returns a list it can filter) and which
  extensions it loads; the host's only policy is the `origin: 'project'` trust gate (anything not
  `builtin` goes through it), and `origin` is declared by whatever loads the extension, not by
  the extension. A loader for repo code (#332) must set `origin: 'project'` itself and should
  supply narrowed services.
- **Built-in extensions get no more access than a third party.** `agents` and `web` take nothing
  from the app that another extension could not read from the same services; options are only
  the embedding app's choices (a provider selector, a summarizer), and
  `harness/extension-options-use-services` fails an `*ExtensionOptions` member whose declared type
  names one a run service carries. The one stated exception:
  `coding` reads its workspace, file locks and process runner from the `CodingHarness` it is
  given (built on `createHarness`, so it also carries the run state), and takes its own `env`
  option (working roots and home); it reads `OUTPUTS` from the services like anyone. A new built-in that needs
  something only the app's code can inject is a missing run service: add the key, not an option.
- **Settings are declared in the manifest and read through the context.** `Extension.settings` is
  derived from the manifest's `settings`, `context.settings.get(KEY)` reads them (the key from
  `settingKey`), and the host validates the user's values at construction: a name nobody
  declares, a value of the wrong type or a name two extensions declare throws.
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
   creates `extensions/<name>/` through npm, with a minimal `sheavly.json` (listed in `files`); it
   refuses a dependency the graph doesn't allow.
2. Declare it in `sheavly.json`: the services it requires, reads optionally and provides, its
   settings, and the tools, hooks and work kinds it contributes. When the package depends on
   another extension (`npm install`), list it in `dependsOn`; the layout check says so.
3. Write `src/extension/<name>.helper.ts`: a `create<Name>Extension(options)` returning
   `defineExtension({ manifest, activate })` with `manifest` from
   `readManifest(new URL('../../sheavly.json', import.meta.url))` (see `extensions/coding`).
   Build tools and hooks in `activate` from the services it reads.
4. Give it a test that activates it through an `ExtensionHost` with a fake `Extension` beside it
   (`@sheavly/extension/testing/extension.fake`).
5. Include it where the run is built: the app (`createBackendHarness`) lists the extensions.
   No package adds an extension to a run.
6. Update its README and `docs/`, then `npm run graph` for the generated tables.

## Writing an extension without editing our source

Checklist for an extension that is not in `extensions/` and reaches the run only through
`createBackendHarness` and its `extensions` option. The packages are private workspaces and
`apps/backend/src/harness/__tests__/third-party-capabilities.test.ts` lives inside `apps/backend`,
so it shows what is reachable from the monorepo through public exports; publishing the packages
and installing an extension (a loader) are #332. It is the test to keep green when the contract
changes.

- Ship a `sheavly.json` at the extension's root (and in its package's `files`): its `name`,
  `dependsOn`, settings and every service, tool, hook and work kind it uses. Read it with
  `readManifest` and pass it to `defineExtension({ manifest, activate })`; the host rejects
  anything undeclared.
- Import only public subpaths: `@sheavly/extension/extension/extension.utils`
  (`defineExtension`, `defineService`, `settingKey`, `placeHook`),
  `@sheavly/extension/manifest/manifest.helper` (`readManifest`),
  `@sheavly/host/run-services/run-services.utils` (the keys), `@sheavly/runtime/tasks/work.utils`
  (background work) and `@sheavly/core/tool/tool.utils`. Never import `coding` or `agents`
  internals.
- A setting: list it in the manifest's `settings`, make the key with `settingKey` and read it
  with `context.settings.get`; the user's value is `extensionSettings`.
- A hook position: `placeHook({ hook, before: [CODING_HOOK_NAMES.agentsMd] })` or `after`, by
  `hook.name` (`CODING_HOOK_NAMES` is public API: see "Built-in hook names" below).
- A service of your own: list it in `services.provides`, `services.provide(KEY, value)`, and
  list the provider in `dependsOn` (and the service in `services.requires` or `optional`) to
  read it.
- Background work: declare a `workKinds` entry in the manifest and start it from a tool with
  `startWork` and `finiteWork` on `services.get(TASKS)` (declared in `requires`), owned by
  `context.session`.
- Asking the user: `services.get(APPROVALS).request(...)`; the UI answers, an extension cannot.
- Telling the UI or the model something: declare `emits` in the manifest, return `events` and
  `notices` with their schemas, and use `context.emit` (types from
  `@sheavly/extension/emit/emit.types`); see "Emitting events and notices" and
  `apps/backend/src/harness/__tests__/third-party-emit.test.ts`.
- The run's own state: `SESSIONS`, `MAIN_SESSION`, `PROVIDER`, `INSTRUCTIONS` and
  `services.find(OUTPUTS)` (absent without an output store). There is no environment service:
  read configuration through a setting.

### Built-in hook names

The coding extension's instruction hooks are named `agents-md`, `skills`, `scratch` and
`working-root`, in that order among the ones present (`scratch` is only registered when the
workspace has a scratch root). They are a stable contract: third parties place hooks before or
after them, so renaming one is a breaking change. The names are `CODING_HOOK_NAMES` in
`@sheavly/coding/extension/coding-hook-names.constants`. Project hooks from `.sheavly/` come after
them, under their own names. `scratch` stays a literal in `@sheavly/workspace` (a package cannot
import an extension), and `extensions/coding/src/extension/__tests__/coding-hook-names.test.ts`
pins all four.

`extensions/coding/sheavly.json` lists the same four names (a JSON file cannot import the
constant) next to a bare `*` for the project hooks, so the host never notices a fifth name added
to the constant but not to the file: the test in
`extensions/coding/src/extension/__tests__/coding-extension.helper.test.ts` compares the two. And
placing a hook before or after a built-in one is ordering, not isolation: any loaded extension's
hooks can see and change what a built-in hook added.

## What is enforced, and what is not

Enforced: the workspace layout (`extensions/*` kind, packages never depend on extensions,
generic workspaces never on coding ones), the extension's public API, the host's collision,
order, settings, hook-order and trust tests, and the host's manifest verification at run time
(an undeclared service, tool, hook or work kind fails loudly; a missing required service skips the
extension). In lint, `harness/extension-definition` checks the call in an extension workspace's
non-test source: `defineExtension({ … })` is an object literal that passes `manifest`, and does
not pass `name`, `dependsOn` or `settings`; `manifest` is
`readManifest(new URL('<path>', import.meta.url))` (written in the call or in a module-level
`const`; `readManifest` is the import from `@sheavly/extension/manifest/manifest.helper`, a local
function of that name is refused) and the path, resolved from the file, is exactly the workspace's `sheavly.json`; an
in-memory manifest object is refused there. The layout check (`npm run layout`, and
`harness/layout` in lint) checks the file: every `extensions/*` workspace has a `sheavly.json`
that parses, whose `name` is the folder and whose `dependsOn` equals, as a set, the other
extension workspaces in the package's `dependencies`, and the package's `files` lists it; no
other workspace has one. Its schema (field types, settings, wildcards) is checked by
`readManifest` when it is read, not by lint. And `harness/extension-options-use-services`: no
member (a property, a method, an index, call or construct signature, an alias body, an `extends`
entry, a generic constraint or default) of an `*ExtensionOptions` type has a declared type that
NAMES a type the host's run services carry (read from the `defineService` calls of its
run-services file, not listed; function-typed options count, and the rule reports loudly if it
cannot read that file), so a built-in is flagged when it takes a registry from the app that a third party could not
read. Matching is by type name.

None of this confines extension code (see "What the manifest is not" above), and the two lint
rules are development guardrails that catch honest mistakes: an extension that wants a registry
can still get one. Review only: that
`activate` does no work the session did not ask for, that a service key is not
a way around an import boundary, that what the manifest declares matches what the code needs (the
host catches an undeclared use at run time, not a declaration nothing uses), an extension built by
a helper instead of a direct `defineExtension` object literal, and a manifest read through
another function than the plain `readManifest` call; for the options rule, an aliased or
re-exported type name (`import type { X as S }`), a `typeof` query of a value and utility or
conditional types that only resolve to a registry, an option typed `unknown`, `any` or a generic
parameter and then cast, a factory parameter outside the `*ExtensionOptions` type, an options type
composed from another type that holds a service type (`Base & { … }`, or a local or imported alias
used as a member's type), an options `class`, an options type not named `*ExtensionOptions`, a
differently named but identical type, and the `harness` option of `coding` (`CodingHarness`, the
stated exception until coding is split). `serves` is reserved: nothing enforces it yet. Nothing
in lint keeps an extension's source from importing `@sheavly/runtime` session internals to
publish: the import rules only check layers and exported kinds, so "an extension reaches what it
needs through `@sheavly/extension`" is a convention held by review and by
`third-party-emit.test.ts`.

Out of scope, as in #102: lazy activation, a `when` language, per-package trust and a
marketplace. A CLI to install and manage extensions, which reads manifests before running any
code, is #332.
