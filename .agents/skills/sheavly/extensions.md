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
  "services": {
    "requires": ["background-tasks"],
    "optional": ["output-reader"],
    "provides": ["notes-store"]
  },
  "grants": ["task:start", "task:read", "output:read"],
  "settings": [{ "name": "notes.max-notes", "type": "number", "default": 50, "description": "…" }],
  "tools": ["add_note"],
  "hooks": ["notes-instructions"],
  "workKinds": ["notes.sync"],
  "emits": { "events": ["notes.progress"], "modelFacingNotices": true }
}
```

- Only `name` is required; unknown keys are rejected at every level, so a typo fails. The file
  is strict JSON (`JSON.parse`, no comments).
- `grants` lists the verb-level capabilities (`<noun>:<verb>`) the extension asks of the host's
  per-extension services; see "Run services and grants" below.
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
- **Before activating, for `grants`**: a grant no supplied service defines (a typo, or a service
  the app did not supply), or one whose service the extension does not read (not in
  `requires`/`optional`), fails the activation (`ExtensionGrantError`, naming the extension and
  the grant) without running `activate`. **At run time**, each method of a scoped service checks
  its grant and throws an `ExtensionUndeclaredError` (`use: 'grant'`) when it is missing. The
  runtime check stays, and lint now reports most such calls first (`harness/extension-declares-grants`,
  see "Run services and grants").
- **During `activate`**, `services.get` of a name not in `requires`/`optional`, `services.find`
  of one not in `optional`/`requires`, and `services.provide` of one not in `provides` throw.
  Services the host supplies (`session-info`, `output-reader` and the rest) must be declared too.
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
it does not `dependsOn` skips the extension. Sharing tools and hooks with sub-agents (the
`sub-agents` service the `agents` extension provides) takes `sub-agents` in `requires` and the
grant `sub-agent:share` in `grants`: the shared names do not appear in the extension's own
`tools` or `hooks` (`share` is a service call, not a contribution), so an installer should read
that grant as the right to put tools and hooks in every sub-agent. `share` without the grant
throws an `ExtensionUndeclaredError` (`use: 'grant'`). The host does not check the shared names
against the sharer's manifest. What an extension shared is revoked when its scope is disarmed (it
failed after sharing, was rolled back or stopped): sub-agents started afterwards do not get it,
running ones keep what they were given. A sub-agent that starts a nested one takes the lists as
they are at that call, so a nested start after a revoke does not get it either.

A contribution adds to the loop and never owns it. It can be:

- `tools` and `hooks` (an instruction source is a hook: `createInstructionHook`); a hook can say
  where it goes with `placeHook({ hook, before, after })`;
- `workKinds`, a declared kind of background work (name and whether it is `finite` or a
  `service`); the work itself still starts through `startWork` ([sessions-and-background-work.md](sessions-and-background-work.md));
- `events` and `notices`, the kinds and topics it may emit, each with the schema of its `data`;
- `instructions: [{ name, text }]`, named sections of the system prompt, declared in the
  manifest's `instructions` and needing the `system-prompt:extend` grant; the host adds no header
  and caps a section at `MAX_INSTRUCTION_CHARS`. `baseInstructions: string` replaces the generic
  base only, needs `system-prompt:replace`, and at most one extension holds it. The text is the
  system prompt, so its content is review-only (`packages/extension/docs/contributions.md`).

### Contributing to the system prompt

Two grants the host offers itself (no service defines them) put text in the model's system prompt:

- `system-prompt:extend`: `instructions: [{ name, text }]`, each `name` declared in the manifest's
  `instructions`.
- `system-prompt:replace`: `baseInstructions: string`, which replaces the generic core only.

They are the strongest grants: what the extension writes IS the system prompt. The host enforces
who may contribute (the grant), the declared names, a non-blank `text` of at most
`MAX_INSTRUCTION_CHARS` (4000), unique section names, at most one replacer, and frozen copies read
once: the extension host reads each contribution field once per check and decides the grant, the
checks and the merge on that one read, so a getter or proxy that answers differently the second
time decides nothing (a list that changes before the merge fails the extension with
`ExtensionContributionChangedError`). `SystemPrompt.contribute` (the app's call, not an
extension's) copies and freezes each section and takes a contribution once; a second call throws.
The cap applies to a replacement base too, so it cannot carry the host's own generic base (about
34 KB): it is for a short base, and an app that needs a long custom base sets `baseInstructions`
itself. The host adds no header. `SystemPrompt` (`@sheavly/host`) composes at each read: the app's
`baseInstructions`, else the one extension replacement, else the generic base; then the sections in
activation order; then the app's own `instructions`. An app's own `baseInstructions` wins: an
extension replacement next to it is refused with `BaseInstructionsConflictError` naming the
extension (the backend rejects with it). The app can also leave a section out, or the replacement
(by the reserved `BASE_INSTRUCTIONS_SECTION` name), with its `omitInstructionSections` option and
always wins; an omitted replacement conflicts with nothing, a name nothing contributed throws an
`UnknownInstructionSectionError`, and the option itself is not reachable by an extension (least
privilege, not a sandbox). The option controls only the declared instruction sections. An
extension's tools, hooks, notices and any section whose name the app does not know are not
covered, and an extension can still infer an omitted section from the composed text: to remove an
extension's influence, leave the extension out. The name `baseInstructions` is reserved for the
replacement: a section cannot take it (the manifest schema and the host refuse it), so omitting it
means one thing. The app hands the activation result's contributions to
`harness.systemPrompt.contribute`; `harness.instructions` is a live getter.

The content is review-only, with one lint check: `harness/prompt-location` requires authored model
text to live in a `*.prompt.ts`. It covers the instruction and `baseInstructions` options passed to
harness APIs and a section's `text` (a literal, a template, a `*.constants.ts` value or a helper's
literal result is reported); it is bounded static tracing (see
`packages/eslint-config/docs/rules.md`), so sections built with `.map` or spread elements, `text`
built at runtime and a dynamically imported module stay review-only, and so do
`Object.assign({ name }, { text: '...' })`, a section array held in a class field,
`c.baseInstructions = '...'` assigned onto a `Contributions` variable and
`{ name, get text() { return '...' } }`, which the rule does not flag. Nothing checks what the text says, and the host's own recorded review (`npm run lint:prompt`) does
not cover an extension's text. **Breaking:** the `INSTRUCTIONS` run service value is a frozen
`{ text }` view, no longer a string: code that read it as a string reads `.text`. This is least
privilege, not a sandbox: the grants mediate the host's composition only.

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
  cannot emit under another's name (no scoped service hands out `publish`, `queueNotice` or
  `publishTask`; only code that imports the runtime itself can bypass it: see below).
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
  and no scoped service hands out `publish`, `queueNotice` or `publishTask` (they are not silent:
  `send` and `report` produce session updates, and a child's loop publishes), but code that
  imports `@sheavly/runtime` and gets hold of a registry by another route could still `publish` or
  `queueNotice`, naming any extension in the envelope (impersonation to the model; the registry
  still refuses a malformed notice). Lint rejects the import in an extension's source, with gaps
  (see "What is enforced"); review keeps an extension on `emit`.
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

## Run services and grants

`packages/host/docs/run-services.md` is the full description; this is the part to know before
writing an extension. Each service below is built **per extension**, the first time it reads it,
and each of its methods throws an `ExtensionUndeclaredError` naming the extension and the grant
when the manifest's `grants` lacks it. Start background work through `BACKGROUND_TASKS` with the
work factories (`startWork`, `@sheavly/runtime/tasks/work.utils`) and ask the user through
`APPROVALS`, which only requests: answering is the UI's. There is no environment service;
configuration is a setting.

| Key                            | Service (name)                 | Grants → what each allows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_INFO`                 | `session-info`                 | `session:read`: `get`, `list`, `isReleased`, `releasedStarts`, `onLifecycle` (metadata, never message content)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `CHILD_SESSIONS`               | `child-sessions`               | `sub-agent:create`: `startChild` (parent is the main session or an owned child), `setModel` on own, `runChild`; `sub-agent:message`: `send` to owned children (never as `'user'`); `sub-agent:observe`: updates of owned children; `sub-agent:report`: report an owned child's status                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `BACKGROUND_TASKS`             | `background-tasks`             | `task:start`: start work it owns; `task:read`: get, report, list, observe its own; `task:cancel`: cancel, group its own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `TASK_CONTROL`                 | `task-control`                 | `task:read-any`: read any extension's task in the calling session (what `task_status` does); `task:cancel-any`: cancel or group any of them (`cancel_task`, `await_tasks`); a `sessionId` is always required and trusted (the service cannot know the caller), so these let an extension name any session of the run                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `OUTPUT_READER`                | `output-reader`                | `output:read`: `log`, `read`, `search` the shared store, which holds EVERY command's complete output, secrets included (only when the app has one)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `OUTPUT_CAPTURE`               | `output-capture`               | `output:capture`: create a new output, which fills the store's quota (only when the app has a store)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `MODEL`                        | `model`                        | `model:call`: model calls on the app's credentials (budgets are deferred)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `APPROVALS`                    | `approvals`                    | `approval:request`: ask the user to approve, plus the read-only `listening`; by default the scope builds the request (attributed to the extension, answered once, no `keeps`, no `always_allow`); `approval:as-tool`: ask as a tool the extension contributes (unprefixed command; contributions are unique across a run, and a request during `activate` is refused); `approval:keep`: pass `options` and `keeps` through, bounded (50 concerns of 1000 characters with visible cuts; at most 20 `keeps` of 500), and the answer must be one of the offered options; whether an entry is kept is the requesting extension's own code, the prompt shows the entries (`always_allow`/`allow_session` need `keeps`); using a field without its grant is refused |
| `INSTRUCTIONS`, `MAIN_SESSION` | `instructions`, `main-session` | none: `main-session` is a constant; `instructions` is a frozen read-only view `{ text }` of the system prompt, composed at each read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

- **Which method needs which grant** is one table, `RUN_SERVICE_GRANTS` in `@sheavly/extension`
  (`run-services/run-service-grants.constants`), and the one place to change when a scope gains a
  method: the host derives each scope's checks and the grants a service offers from it, a host test
  fails when a scope has a method the table does not declare, and the lint rule below reads it.
- **Lint checks your calls against your manifest.** The runtime check above stays, but
  `harness/extension-declares-grants` also fails, in the production source of `extensions/*`, a
  call to a method of a scoped service whose grant the workspace's `sheavly.json` does not list.
  It follows a scope read with `services.get`/`find` (bound or chained) and a parameter or
  variable annotated with a scope's type, and the grant of `tool`, `options` or `keeps` when an
  approval request is an object literal. It reads syntax only: a scope passed around without an
  annotation, destructuring, a stored or copied scope, a non-literal request and a service an
  extension provides stay review-only, and a grant declared but never called is not reported.
  What it recognises and misses is in `packages/eslint-config/docs/rules.md`.
- **A grant is `<noun>:<verb>`** (lowercase kebab parts, one colon), declared in the manifest's
  `grants` and readable by an installer before any code runs. The catalogue is what the supplied
  services declare, the ones an extension's `services.grants` declares for a service it provides
  (`sub-agent:share`, of `sub-agents`: share tools and hooks with every sub-agent), plus the two
  the host offers itself with no service: `system-prompt:extend` and `system-prompt:replace` (the
  strongest grants: what the extension writes is the system prompt); a grant is verb-level, one capability, and a new capability is a new grant,
  never a widened one. Grants are global strings, not per service: two providers may declare the
  same name and a consumer that lists it and requires either service verifies (no bypass: each
  service still needs its own `requires` and enforces its own methods), so name a grant after the
  provider's capability (`<noun>:<verb>`).
- **Nothing exposes a registry.** No scoped service hands out `publish`, `queueNotice`,
  `publishTask`, `end`, `release`, `cancelAll`, `cancelSession`, an inbox or a stream of message
  content (`send` and `report` do produce session updates, and a child's loop publishes).
  Ownership sets are private to each extension's scope, so two extensions with the same grants own
  different sub-agents and tasks. Scope objects are frozen, and what they return or share is
  frozen copies (a child's ref, `main-session`), never the run's live objects. The loop keeps the
  full objects: `runChild` owns the call into it (it refuses a child that is not owned, ended or
  already running).
- **Disarming.** The host disarms the scopes BEFORE the extension's own `deactivate` runs. A
  disarmed scope refuses calls and stops its subscriptions, but does not abort a `runChild`
  already in flight nor cancel the tasks it started.
- **No privileged built-ins: `origin` only gates loading.** `agents` is held to its manifest
  exactly as a third-party fixture is, and no service may check `origin`. What an extension can do
  follows from its declared grants and the shape of each service.
- **A grant no service defines fails the activation**, as does one whose service the extension
  does not read (`ExtensionGrantError`): a typo cannot silently grant nothing.
- **An extension can define grants for a service it provides**, per consumer: see "Providing a
  service per consumer" below.
- The old whole-registry keys (`SESSIONS`, `TASKS`, `OUTPUTS`) are gone, and so are `PROVIDER`
  (now `MODEL`) and the `sessions`, `tasks` and `outputs` service names: an extension that still
  requires one is skipped (reason `service`, `missing`). The `sub-agents` service `agents`
  `provides` is separate and WRITE-ONLY: only `share` (which copies and freezes its input) is
  public, so reading it grants no way to call or change what others shared. A message to a session
  the extension did not start now reads `Unknown session`.

### Providing a service per consumer

`services.provide(KEY, value)` hands every reader one value, so the provider cannot tell who
calls. A service that limits what each caller may do uses
`services.provideFor({ key, create(consumer) })` (full description:
`packages/extension/docs/services.md`).

- **Manifest.** `services.grants` maps a service the extension provides to the grants it
  understands: `{ "sub-agents": ["sub-agent:share"] }`. Its keys must be in `provides`, and a grant
  a host service offers is refused. The catalogue includes them, so a consumer lists the grant in
  `grants` and the service in `requires` or `optional`; a typo or an unread service fails its
  activation (`ExtensionGrantError`), as for a host service.
- **The host** calls `create` once per reading extension, on its first read, with the consumer's
  `name`, sealed manifest and a `contributedTools()` that answers live. The consumer is one frozen
  snapshot per extension (the extension holds the same object when it reads its own service), so
  nothing can rename it or swap its function. A provider that declares grants for a service MUST
  use `provideFor`: a plain `provide` fails its activation.
- **The provider enforces.** Each method checks the grant with `requireGrant` over
  `consumer.manifest.grants` and throws `ExtensionUndeclaredError` (`use: 'grant'`). The host
  cannot check that a provider's methods check the right grant, or any: review covers it. `agents`
  is the example (`sub-agents`, `SUB_AGENT_SHARE_GRANT` in
  `extensions/agents/src/agents/agents.constants.ts`; `coding` and `web` declare it; `agents`'
  own output tools are shared directly, with no grant).
- **Lifecycle.** The returned `disarm` runs once on every path that disarms the host's scopes for
  the consuming extension, and when the provider itself reaches a final state, so a scope never
  outlives its provider; a value read after either is born disarmed. A `disarm` should not throw;
  if it does, the host contains it (the others are still disarmed, every `deactivate` still runs)
  and reports the error with `deactivate()`'s, or in `lateDeactivationErrors` while activating;
  when the activation fails, the next `deactivate()` returns it once. A `disarm` that returns a
  promise is not awaited: a rejection is collected when it settles (best effort), and one that
  hangs synchronously blocks `deactivate()`.
  What a scope handed on is the provider's own business: `agents` revokes what a consumer shared.
  See "Scoped service" in
  [state-machines.md](state-machines.md).
- **Attribution.** `consumer.contributedTools()` answers only once the consumer is `merged`
  (see "Extension in the host" in [state-machines.md](state-machines.md)).

Like every grant, this is least privilege, not a sandbox.

## Rules

- **The framework imposes no category or policy on extensions.** There is no kind, domain or
  preset an extension must fit: each defines what it can and cannot do itself, so others can build
  extensions without changing our source.
- **Names collide loudly.** Two tools, hooks, work kinds, settings or services with one name
  throw a `ContributionCollisionError` naming both extensions (or the host, for a service it
  supplies). Nothing shadows anything.
- **The host supplies run services any extension can read.** They come from the app as
  `hostService` entries, readable without a `dependsOn` once declared in `requires`/`optional`;
  an extension cannot provide a key the host supplies. The app builds them with `runServices`
  (`@sheavly/host/run-services/run-services.helper`, the one place they are made). The host
  implements the services; the keys and the types they carry are defined by `@sheavly/extension`
  (see "The contract between an app and an extension"). No service is a whole registry: each is narrow, built per extension, and checks
  the grants the extension's manifest declares. See "Run services and grants" below.
- **Run services are least privilege, not a sandbox.** An extension is Node code: it can use `fs`,
  `child_process`, `fetch` and `process.env`, and can import runtime classes, without declaring
  anything. A grant limits what a service does for an extension, nothing more. The app decides
  which services it supplies (`runServices` returns a list it can filter) and which extensions it
  loads; the host's only policy is the `origin: 'project'` trust gate, which gates loading and
  nothing else (see below), and `origin` is declared by whatever loads the extension, not by the
  extension. A loader for repo code (#332) must set `origin: 'project'` itself.
- **Built-in extensions get no more access than a third party.** There is no privileged tier:
  `origin` only gates loading (`isTrusted`), and no service reads it. `agents` and `web` take
  nothing from the app that another extension could not read from the same services under the same
  grants; options are only the embedding app's choices (a provider selector, a summarizer), and
  `harness/extension-options-use-services` fails an `*ExtensionOptions` member whose declared type
  names a type a run service carries or a registry type of `Harness`. There is no exception:
  `coding` opens its own workspace, file reads and process runner and takes `workspaceRoot`,
  `scratchRoot`, `fileLocks` and `env` options; it reads `SESSION_INFO` (`session:read`),
  `BACKGROUND_TASKS` (`task:start`), `APPROVALS` (`approval:request`, `approval:as-tool`,
  `approval:keep`), `MAIN_SESSION`, `SUB_AGENTS` and the optional `OUTPUT_CAPTURE`
  (`output:capture`) like any extension. A new built-in that needs
  something only the app's code can inject is a missing run service: add the service (and its
  grants), not an option.
- **Settings are declared in the manifest and read through the context.** `Extension.settings` is
  derived from the manifest's `settings`, `context.settings.get(KEY)` reads them (the key from
  `settingKey`), and the host validates the user's values at construction: a name nobody
  declares, a value of the wrong type or a name two extensions declare throws. The values come
  from up to three files, strongest first: the user's global `~/.sheavly/settings.json`, the
  profile's, then the settings file in the project's own `.sheavly` folder. A setting's `scope` (`user` by default,
  or `project`) says whether the project's file may set it at all, and `restricted` (only with
  `project`) that it is honoured only in a trusted workspace; what the project's file sets
  against those rules, or cannot be read, is ignored and reported, never silently used. A setting
  name that looks like a credential (a whole segment such as `key`, `token`, `password`, `pwd`,
  `bearer`, `auth`; the full list and its known gaps are in the manifest guide) is refused in the
  manifest: keys stay in the profile store.
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
  not deactivated: `activate` cleans up after itself before it throws. What an extension shared
  through `SUB_AGENTS` is revoked when its scope is disarmed (a failed `activate` included), so
  sub-agents started afterwards do not get it; sharing as the last step still keeps a failure from
  leaving anything behind in a provider that does not revoke.
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
  `dependsOn`, settings, the `grants` it needs and every service, tool, hook and work kind it
  uses. Read it with
  `readManifest` and pass it to `defineExtension({ manifest, activate })`; the host rejects
  anything undeclared.
- Import only public subpaths: `@sheavly/extension/extension/extension.utils`
  (`defineExtension`, `defineService`, `settingKey`, `placeHook`),
  `@sheavly/extension/manifest/manifest.helper` (`readManifest`),
  `@sheavly/extension/run-services/run-services.utils` (the keys),
  `@sheavly/extension/run-services/run-services.types` (the types the app hands you),
  `@sheavly/runtime/tasks/work.utils` (background work) and `@sheavly/core/tool/tool.utils`.
  Never import `@sheavly/host`, nor `coding` or `agents` internals.
- `@sheavly/extension` provides the contract and the pure helpers an extension shares with the
  host: `joinInstructions` (`instructions/instructions.utils`) and `keepsFit` with its limits
  (`approval/approval-keeps.utils`, `approval-keeps.constants`). The service keys, the types the
  app hands an extension (the scope views included) and `ScopeDeactivatedError`
  (`@sheavly/extension/errors/scopes.errors`) are in it too: see "The contract between an app and
  an extension".
- A setting: list it in the manifest's `settings`, make the key with `settingKey` and read it
  with `context.settings.get`; the user's value comes from the layered settings files (global,
  then profile, then the settings file in the project's own `.sheavly` folder), and `scope` and `restricted` say
  whether and when the project's file may set it.
- A hook position: `placeHook({ hook, before: [CODING_HOOK_NAMES.agentsMd] })` or `after`, by
  `hook.name` (`CODING_HOOK_NAMES` is public API: see "Built-in hook names" below).
- A service of your own: list it in `services.provides`, `services.provide(KEY, value)`, and
  list the provider in `dependsOn` (and the service in `services.requires` or `optional`) to
  read it.
- Background work: declare a `workKinds` entry in the manifest and start it from a tool with
  `startWork` and `finiteWork` on `services.get(BACKGROUND_TASKS)` (`background-tasks` in
  `requires`, grants `task:start` and `task:read`), owned by `context.session`.
- Asking the user: `services.get(APPROVALS).request(...)` (`approvals` in `requires`, grant
  `approval:request`); the UI answers, an extension cannot. Naming one of the tools you
  contribute as the asker needs `approval:as-tool`; offering `options` and `keeps` (the user's
  "allow for this session" and "always allow") needs `approval:keep`. The host only passes them
  through and checks the answer was offered: keeping an entry after the answer is your own code
  (coding persists them through its permissions), and entries that do not fit the limits
  (`keepsFit`, `@sheavly/extension/approval/approval-keeps.utils`) are better left out than
  refused.
- Telling the UI or the model something: declare `emits` in the manifest, return `events` and
  `notices` with their schemas, and use `context.emit` (types from
  `@sheavly/extension/emit/emit.types`); see "Emitting events and notices" and
  `apps/backend/src/harness/__tests__/third-party-emit.test.ts`.
- The run's own state: `SESSION_INFO`, `CHILD_SESSIONS`, `MAIN_SESSION`, `MODEL`, `INSTRUCTIONS`
  (a live `{ text }` view: read `.text` when you need the prompt, each time, never cache it as a
  string) and `services.find(OUTPUT_READER)` / `find(OUTPUT_CAPTURE)` (absent without an output store),
  each with its grants (see "Run services and grants"). There is no environment service: read
  configuration through a setting.
- Before you finish, these four catch a broken contract:
  - `harness/extension-public-contract` (lint): reports a literal import of `@sheavly/host`, a
    contract name taken from another `@sheavly` package than `@sheavly/extension`, and an import
    of test code (`testing/` path, `.fake` file) in production source; its limits are in
    `packages/eslint-config/docs/rules.md`.
  - `harness/extension-declares-grants` (lint): reports a call to a scoped run service's method
    whose grant your `sheavly.json` does not list; its limits are in the same file.
  - `extensions/coding/src/extension/__tests__/coding-hook-names.test.ts`: pins the built-in hook
    names (`agents-md`, `skills`, `scratch`, `working-root`) you place hooks around.
  - `packages/extension/src/host/__tests__/outside-consumer.test.ts`: type-checks and runs an
    extension built from public exports only, and proves the grant is enforced.

## The contract between an app and an extension

`@sheavly/extension` is the contract; the host implements it and defines no keys.

- **What it holds.** The ten run-service keys in `run-services/run-services.utils` (`INSTRUCTIONS`,
  `MAIN_SESSION`, `APPROVALS`, `SESSION_INFO`, `CHILD_SESSIONS`, `BACKGROUND_TASKS`,
  `TASK_CONTROL`, `OUTPUT_READER`, `OUTPUT_CAPTURE`, `MODEL`); the types the app hands an
  extension in `run-services/run-services.types` (`ExtensionApprovalRequest`, `ApprovalRequester`,
  `SystemPromptView`, and the scope views it re-exports: `ChildSessionScope`, `RunChildParams`,
  `RunChildResult`, `SessionInfoView`, `SessionLifecycleUpdate`, `BackgroundTaskScope`,
  `TaskStarter`, `TaskControl`, `OutputReader`, `OutputCapture`); and `ScopeDeactivatedError` in
  `errors/scopes.errors`. It depends on `@sheavly/runtime` for the view types only (type imports,
  no cycle). The host's own scope errors (`ScopeArgumentError`, `ApprovalToolNotContributedError`,
  `ChildRunningError`) stay in `@sheavly/host/errors/scopes.errors`: they are not the contract.
- **What else an extension may import.** As many libraries as its own substance needs: core,
  protocol, the runtime's helpers (errors, locks, work factories), workspace, process, tools and
  other extensions. Only the contract with the app comes from `@sheavly/extension`, never from
  `@sheavly/host`.
- **The rule.** `harness/extension-public-contract` reports, in the non-test, non-fake
  `src/**/*.{ts,tsx}` of `extensions/*`: (1) an import of `@sheavly/host` in any form with a
  literal specifier (static, `import type`, `export … from`, `export * from`, `import()`,
  `typeof import()`, `import('…').X`, `import x = require()`); (2) an import of a contract name
  from another `@sheavly` package than `@sheavly/extension` (a third-party library is not
  checked); (3) an import of test code in production source (a relative path with a `testing/`
  segment, a `.fake` file, a path into an `@sheavly` package with a `testing/` segment), since fakes may
  import the host. The names are read from the extension package's own files, matched by imported
  name, not by shape. It is lint, not a sandbox: a non-literal dynamic import, `require`,
  `createRequire(…)(literal)`, an import behind a local re-export file and unusual casing are not
  seen. The full list of limits is in `packages/eslint-config/docs/rules.md`. The dependency kind
  of the host is the layout check's (`npm run layout`): an extension may list `@sheavly/host` only
  in `devDependencies`.
- **The outside-consumer test.** `packages/extension/src/host/__tests__/outside-consumer.test.ts`
  builds a throwaway workspace with an extension from public exports only, type-checks it with the
  repo's compiler options through the real `exports` maps, runs it through a real host and proves
  the grant is enforced. It does not prove the exports are the right API or the published `dist`
  layout, and it links `@sheavly/runtime` not at all: the extension package's types import runtime
  types, which resolve from the symlink's real path in the repo, so an author who installs only
  the four linked packages is not shown to resolve them (see `packages/extension/docs/services.md`).

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
extension; a grant no service defines, or of a service the extension does not read, fails the
activation; and every scoped-service method refuses a call whose grant the manifest lacks, a
scope refuses what the extension did not start and every scope throws `deactivated` once the host
stops the extension). **By the host at run time**, then: the manifest, the grants, ownership and
disarming. In lint, `harness/extension-definition` checks the call in an extension workspace's
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
cannot read that file) or a registry type of `Harness` (read from `host.types.ts`), so a built-in
is flagged when it takes a registry from the app that a third party could not read. Matching is
by type name. And `harness/extension-no-runtime-registries`: in the non-test source of
`extensions/*`, a value import of the runtime session, task or approval service modules (the
modules `Harness` types its registries from) or of `createHarness` fails, so an extension's code
does not build or reach a registry by importing one (a relative path into a workspace's `src/`
and `..` segments in a package specifier are resolved first). And
`harness/extension-declares-grants`: a call to a method of a scoped run service whose grant the
workspace's `sheavly.json` lacks fails lint, for the forms the rule follows (see "Run services and
grants"); the converse, a declared grant no call uses, is not reported. It has no exception list: no
extension, `coding` included, may take a registry, and a test checks that the real tree has no
violation. Its gaps: files under `testing/` and `__tests__` are exempt by file kind, and value
imports of the loop's runner (`runSession`) and of host `*Scope` classes are not flagged.

**Enforced at run time by the host:** an undeclared service or grant is refused, and so is a field
a grant covers (`tool` without `approval:as-tool`, `options`/`keeps` without `approval:keep`); a
`tool` must be one the extension contributes (checked against the names the host recorded after
`activate`, so a request during `activate` is refused). **By lint:** the rules above. **By
review only:** the list below.

**This is least privilege, not a sandbox.** None of this confines extension code (see "What the
manifest is not" above): an extension is Node code and can still import runtime classes through a
path the rule does not see, use `fs`, `fetch` and `child_process`, or read the environment. The
host's run-time checks mediate only what goes through the services, and the lint rules are
development guardrails that catch honest mistakes. **Review only:** that
`activate` does no work the session did not ask for, that a service key is not
a way around an import boundary, that what the manifest declares matches what the code needs (lint
catches an undeclared grant for the calls it follows and the host catches an undeclared use at run
time; nothing catches a declaration nothing uses, and a call lint does not follow is seen only when
it runs), an extension built by
a helper instead of a direct `defineExtension` object literal, and a manifest read through
another function than the plain `readManifest` call; for the options rule, an aliased or
re-exported type name (`import type { X as S }`), a `typeof` query of a value and utility or
conditional types that only resolve to a registry, an option typed `unknown`, `any` or a generic
parameter and then cast, a factory parameter outside the `*ExtensionOptions` type, an options type
composed from another type that holds a service type (`Base & { … }`, or a local or imported alias
used as a member's type), an options `class`, an options type not named `*ExtensionOptions`, a
differently named but identical type. Also review-only
for the import rule: a registry reached through a type-only import turned into a value, a dynamic
`import()` of a non-literal path, a computed `require`, `globalThis`, a registry obtained from
another object the extension is handed, and a grant that is declared but needlessly broad (the host fails a grant nobody defines, not one
the code never uses). `serves` is reserved: nothing enforces it yet. "An extension reaches what it
needs through `@sheavly/extension` and the scoped services" is held by those checks, by review and
by `third-party-emit.test.ts`.

Out of scope, as in #102: lazy activation, a `when` language, per-package trust and a
marketplace. A CLI to install and manage extensions, which reads manifests before running any
code, is #332.
