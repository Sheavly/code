# Lifecycle

What `ExtensionHost` does from construction to `deactivate`, and what it does when something goes
wrong.

## Construction

`new ExtensionHost({ extensions, services, settings, isTrusted })` validates the setup and throws
on a mistake: a repeated name, a dependency that is not loaded or a cycle (named in full) is an
`ExtensionGraphError`; a setting value no extension declares or of another type than its default
is an `ExtensionSettingError`; two extensions declaring one setting, or two host services with one
name, is a `ContributionCollisionError`. The extensions are put in dependency order: each after
what it depends on, otherwise in the order given. The host puts no category on an extension, so
nothing else about an extension can fail construction.

## Activation

`activate({ signal })` runs once per session; a second call throws an `ExtensionHostStateError`.
Each extension's `activate(context)` is awaited in order and returns its contributions. The
result holds the merged `contributions` (hooks already placed), the `settings` of the extensions
that activated, the `active` names, `failed` and `skipped`. An aborted `signal` stops the rest:
what activated is deactivated and the abort reason is thrown, and so is a contribution collision
or a `HookOrderError`.

## Failure isolation

One extension failing never stops the others.

- An `activate` that throws, or an `isTrusted` check that throws, is reported in `failed` as an
  `ExtensionActivationError` and the services it provided are dropped.
- What depends on a failed or skipped extension is `skipped` with the reason `dependency`.
- The caller decides whether that is fatal. The backend deactivates what activated and throws.
- An extension whose `activate` threw is not deactivated, so `activate` cleans up after itself
  before it throws. Share with another extension's scope as the last step of `activate`: what is
  shared is not taken back.

## Trust gating

Content needs no trust, code does. An extension with `origin: 'project'` is skipped with the
reason `untrusted` unless `isTrusted` says its code is trusted; builtin extensions never ask.
`origin` is a declaration by the app that loads the extension, not something the host can verify.

## Deactivation

`deactivate()` closes the host and deactivates the activated extensions, last first, once. One
`deactivate` throwing never stops the others; the errors are returned for the caller to report.
Called while `activate` is still running, it stops the rest from starting. An extension that
finishes activating afterwards is deactivated at once and its error, if any, lands in
`lateDeactivationErrors`, with `active` and `contributions` empty.
