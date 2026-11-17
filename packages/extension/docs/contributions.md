# Settings and hook order

Two things an extension says about itself that the host acts on: which settings it reads, and where
its hooks go among the run's other hooks.

## Settings

A setting is a static declaration, like `name` and `dependsOn`, so the host can check the user's
values before anything activates.

- `defineSetting({ name, description, default })` makes a `SettingKey<T>`; `T` is the type of the
  default (`string`, `number` or `boolean`). The name is `<extension>.<setting>`, each part
  lowercase words joined by hyphens, or an `ExtensionDefinitionError` is thrown.
- The extension lists its keys in `Extension.settings` and reads them in `activate` with
  `context.settings.get(KEY)`: the user's value if the host was given one, otherwise the default.
  Reading a key the extension did not declare throws an `ExtensionSettingError`.
- The app passes the user's values by setting name in `ExtensionHostOptions.settings`. At
  construction (`assertSettings`) the host throws when a value's name is declared by no extension
  (a typo must not pass silently), when its type differs from the declared default's
  (`ExtensionSettingError`), or when two extensions declare one name (a
  `ContributionCollisionError` with the contribution `setting`).
- `ActivationResult.settings` lists a `SettingInfo` (extension, name, description, default, value)
  for each setting of the extensions that activated, for a UI to show.

## Hook order

Hooks run in the order the host merges them. A hook is contributed bare, which keeps activation
order, or placed with `placeHook({ hook, before, after })`, where `before` and `after` name other
hooks by `hook.name`.

`mergeContributions` orders the merged hooks (`orderHooks`):

1. Start from activation order (extensions in dependency order, an extension's hooks in the order
   it returned them).
2. Satisfy the constraints by changing that order only as far as they need: the hook that is
   placed moves, to just before the hook named in `before` or just after the one named in
   `after`, and the hooks between them stay where they were. (A topological sort that takes, of
   the hooks free to go, the one needed earliest; a hook placed `before` another is needed as
   early as the place the named hook originally was in activation order. If that hook is itself
   placed `after` something, it ends up later and the placed hook does not follow it: with `a`
   placed `after` `c` and `x` placed `before` `a`, `a, b, c` becomes `x, b, c, a`.)
3. A constraint naming a hook that is not in the run is ignored: the other extension may not be
   loaded.
4. A cycle, or a hook constrained against itself, throws a `HookOrderError` naming the hooks
   involved. Two hooks with one name still throw a `ContributionCollisionError`.

Hooks an extension shares with sub-agents through the agents extension's `SUB_AGENTS.share({ hooks })`
are not placed: they stay a plain list in the order the sharer gave them.

The `after` field a `Hook` itself carries is the loop's own ordering, applied when the run starts
and failing for a name the run lacks; `placeHook` is the tolerant form for hooks of other
extensions.
