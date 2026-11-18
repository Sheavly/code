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
by one of its dependencies. Each extension's `activate(context)` is then awaited in order and
returns its contributions, which the host checks against the manifest's `tools`, `hooks`,
`workKinds` and `emits` (see [manifest](manifest.md)). The context holds an `emit` built for that
extension; it throws until the contributions passed that check, and again (`deactivated`) once
the host stops, drops or fails the extension (see Deactivation). The result holds the merged `contributions` (hooks already placed), the `settings` of the extensions
that activated, the `active` names, `failed` and `skipped`. An aborted `signal` stops the rest:
what activated is deactivated and the abort reason is thrown, and so is a contribution collision
or a `HookOrderError`.

## Failure isolation

One extension failing never stops the others.

- An `activate` that throws, or an `isTrusted` check that throws, is reported in `failed` as an
  `ExtensionActivationError` and the services it provided are dropped.
- An extension that reads a service, or provides one, its manifest does not list throws an
  `ExtensionUndeclaredError` at that call, inside its `activate`, which is a failure like any
  other `activate` that throws. One that contributes a tool, hook or work kind its manifest does
  not list (exactly, or through a `*` wildcard entry) fails after `activate` returned: it is deactivated (it had activated; an error from
  that `deactivate` lands in `lateDeactivationErrors`), its services are dropped and nothing it
  contributed is merged. Both are reported in `failed`, with the `ExtensionUndeclaredError` as the
  `cause`.
- An extension whose manifest requires a service nobody offers it is not activated: it is
  `skipped` with the reason `service` and the `missing` names.
- What depends on a failed or skipped extension is `skipped` with the reason `dependency`.
- The caller decides whether that is fatal. The backend deactivates what activated and throws.
- An extension whose `activate` threw (an undeclared service use included) is not deactivated, so `activate` cleans up after itself
  before it throws. Share with another extension's scope as the last step of `activate`: what is
  shared is not taken back.

## Trust gating

Content needs no trust, code does. An extension with `origin: 'project'` is skipped with the
reason `untrusted` unless `isTrusted` says its code is trusted; builtin extensions never ask.
`origin` is a declaration by the app that loads the extension, not something the host can verify.

## Deactivation

Every path that stops, drops or fails an extension also disarms its `context.emit`: `deactivate()`
(before any extension's own `deactivate` runs), a roll-back for a changed contribution (with its
dependents), a late stop, a collision or abort, and a failed `activate` or contribution check.
After that an emit throws an `ExtensionEmitError` with failure `deactivated`, so a tool or task
that kept the capability cannot publish events or queue notices. (A session's outbox holds at most
100 notices, `MAX_QUEUED_NOTICES`; past it `emit.notice` throws.)

`deactivate()` closes the host and deactivates the activated extensions, last first, once. One
`deactivate` throwing never stops the others; the errors are returned for the caller to report.
Called while `activate` is still running, it stops the rest from starting. An extension that
finishes activating afterwards is deactivated at once and its error, if any, lands in
`lateDeactivationErrors`, with `active` and `contributions` empty. That list also holds the
`deactivate` errors of an extension stopped for contributing what its manifest does not declare.
