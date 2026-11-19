# Lifecycle

What `ExtensionHost` does from construction to `deactivate`, and what it does when something goes
wrong.

## Construction

`new ExtensionHost({ extensions, services, settings, isTrusted })` validates the setup and throws
on a mistake: a repeated name, a dependency that is not loaded or a cycle (named in full) is an
`ExtensionGraphError`; a setting value no extension declares or of another type than its default
is an `ExtensionSettingError`; two host services with one name is a `ContributionCollisionError`.
(Two extensions cannot declare one setting: a setting name starts with its extension's name, and
extension names are unique.) The extensions are put in dependency order: each after what it
depends on, otherwise in the order given. The host puts no category on an extension, so nothing
else about an extension can fail construction.

## Activation

`activate({ signal })` runs once per session; a second call throws an `ExtensionHostStateError`.
Before an extension's `activate`, the host checks that it is not skipped (below) and that every
service in its manifest's `services.requires` is readable by it: supplied by the host or provided
by one of its dependencies, and that each of its manifest's `grants` is offered by a service it
reads, one the host supplies or one an extension's `services.grants` declares (otherwise an `ExtensionGrantError` fails it before `activate` runs: see
[manifest](manifest.md#grants)). Each extension's `activate(context)` is then awaited in order and
returns its contributions, which the host checks against the manifest's `tools`, `hooks`,
`instructions`, `workKinds`, `emits` and the system-prompt grants (see [manifest](manifest.md)). The context holds an `emit` built for that
extension; it throws until the contributions passed that check, and again (`deactivated`) once
the host stops, drops or fails the extension (see Deactivation). The result holds the merged `contributions` (hooks already placed), the `settings` of the extensions
that activated, the `active` names, `failed` and `skipped`. An aborted `signal` stops the rest:
what activated is deactivated and the abort reason is thrown, and so is a contribution collision
or a `HookOrderError`.

## States

The host holds one state per extension (`ExtensionStates`), moved only along one table
(`EXTENSION_TRANSITIONS` in `host/extension-state.constants.ts`; `canMove` in
`extension-state.utils.ts` answers whether a move is listed, and a move that is not throws an
`ExtensionStateError`). A test fails when the block below differs from the table.

<!-- extension-lifecycle:start -->

| State         | May move to                        |
| ------------- | ---------------------------------- |
| `sealed`      | activating                         |
| `activating`  | verified, skipped, failed, stopped |
| `verified`    | merged, rolled-back, stopped       |
| `merged`      | stopped                            |
| `skipped`     | final                              |
| `failed`      | final                              |
| `rolled-back` | final                              |
| `stopped`     | final                              |

<!-- extension-lifecycle:end -->

- `sealed`: known to the host, not reached yet (one never reached stays here).
- `activating`: its trust and service checks, its `activate` and the check of what it returned are
  running.
- `verified`: `activate` returned and its contributions were snapshotted and checked against the
  manifest; its emit capability is armed. Nothing is merged yet.
- `merged`: the one merge at the end of `activate`, which checks names across extensions, passed.
  Every surviving extension moves from `verified` to `merged` together; a collision throws before
  any of them does, so none is merged.
- `skipped`, `failed`, `rolled-back` and `stopped` are final. `skipped`: it never ran. `failed`: its
  `activate`, its trust check or its manifest check threw. `rolled-back`: its contributions changed
  after the check, or it depends on one whose did. `stopped`: the host closed (`deactivate()`, a
  late finish after the close, or a close before it started).
- Every move into a final state ends the extension's `emit` capability and disarms its
  per-extension services; `failed` and `rolled-back` also drop the services it provided.

`ServiceConsumer.contributedTools()` reads this state (the consumer is a frozen snapshot, its
function closed over the extension's name, so an extension cannot swap it): it holds the tool names checked against the
manifest only while the extension is `merged`. It is empty while the extension is `activating` or
`verified` (so an extension that already returned cannot be attributed a tool name another
extension also contributes before the collision check), and empty again in every final state.

## Failure isolation

One extension failing never stops the others.

- An `activate` that throws, or an `isTrusted` check that throws, is reported in `failed` as an
  `ExtensionActivationError` and the services it provided are dropped.
- An extension that reads a service, or provides one, its manifest does not list throws an
  `ExtensionUndeclaredError` at that call, inside its `activate`, which is a failure like any
  other `activate` that throws. One that contributes a tool, hook, instruction section or work kind its manifest does
  not list (exactly, or through a `*` wildcard entry; sections match exactly), that contributes
  sections or a replacement base without the `system-prompt:extend` or `system-prompt:replace`
  grant, or whose prompt text is blank, not a string or over the cap, fails after `activate` returned: it is deactivated (it had activated; an error from
  that `deactivate` lands in `lateDeactivationErrors`), its services are dropped and nothing it
  contributed is merged. Both are reported in `failed`, with the `ExtensionUndeclaredError` as the
  `cause`.
- An extension whose manifest requires a service nobody offers it is not activated: it is
  `skipped` with the reason `service` and the `missing` names.
- What depends on a failed or skipped extension is `skipped` with the reason `dependency`.
- The caller decides whether that is fatal. The backend deactivates what activated and throws.
- An extension whose `activate` threw (an undeclared service use included) is not deactivated, so `activate` cleans up after itself
  before it throws. Share with another extension's scope as the last step of `activate`: a
  provider decides what a disarm takes back (`agents` revokes what a consumer shared, for sub-agents
  started afterwards), and one that does not leaves it in place.

## Trust gating

Content needs no trust, code does. An extension with `origin: 'project'` is skipped with the
reason `untrusted` unless `isTrusted` says its code is trusted; builtin extensions never ask.
`origin` is a declaration by the app that loads the extension, not something the host can verify.

## Deactivation

Every path that stops, drops or fails an extension also disarms its `context.emit`: `deactivate()`
(before any extension's own `deactivate` runs), a roll-back for a changed contribution (with its
dependents), a late stop, a collision or abort, and a failed `activate` or contribution check.
After that an emit throws an `ExtensionEmitError` with failure `deactivated`, so a tool or task
that kept the capability cannot publish events or queue notices. The same paths call the `disarm`
of every per-extension service instance (`hostServiceFor`, or an extension's `provideFor`), so a
scope an extension kept stops working too ([services](services.md#per-extension-services-factories)).
An extension entering a final state also disarms every scope its own `provideFor` services handed
out, so a scope never outlives its provider
([services](services.md#services-an-extension-provides-per-consumer)). (A session's outbox holds at most
100 notices, `MAX_QUEUED_NOTICES`; past it `emit.notice` throws.)

`deactivate()` closes the host and deactivates the activated extensions, last first, once. A second
call does not stop anything again: it returns what an activation that failed closed the host with
(see below), once, and what a scope built after the close contained; otherwise `[]`. One
`deactivate` throwing never stops the others; the errors are returned for the caller to report.
A service instance's `disarm` that throws is contained the same way: the instance counts as
ended once, every other instance is still disarmed, every `deactivate` still runs and the move
into a final state still completes. Its error is returned with the others (first in the list);
one thrown while activating (a failed or rolled-back extension) lands in
`lateDeactivationErrors` and `activate()` still resolves. A `disarm` that returns a promise is
not awaited (a hang there cannot block the stop) and a rejection is collected when it settles,
possibly after the call returned: the next `deactivate()` that runs after that returns it. A
`disarm` that hangs synchronously blocks `deactivate()` for every extension.

An activation that fails (a contribution collision, an abort) closes the host and throws, as
before, with the same error. What that closing contained would be lost with the rejection: the
disarm errors, the `deactivate` errors of the extensions it stopped, and the late errors
collected so far. The host keeps them, and the next `deactivate()` returns them once, then `[]`.
The backend's `closeExtensions` calls it after a failed `activate` and reports each through
`onProblem`.
Called while `activate` is still running, it stops the rest from starting. An extension that
finishes activating afterwards is deactivated at once and its error, if any, lands in
`lateDeactivationErrors`, with `active` and `contributions` empty. That list also holds the
`deactivate` errors of an extension stopped for contributing what its manifest does not declare.
