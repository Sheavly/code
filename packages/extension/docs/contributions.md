# Settings and hook order

Two things an extension says about itself that the host acts on: which settings it reads, and where
its hooks go among the run's other hooks. The tools, hooks and work kinds an extension contributes
must also be named in its manifest's `tools`, `hooks` and `workKinds`, or its activation fails
(see [manifest](manifest.md)), exactly or by a wildcard entry such as `project-hooks.*` for names
only known at run time; a placed hook is named by its inner hook. The `events` (each kind listed
exactly in `emits.events`) and `notices` (topics in its own namespace, with
`emits.modelFacingNotices` set) it returns are held to the manifest the same way; with their
`data` schemas they say what its `context.emit` may send.

## System-prompt sections

An extension can put text in the system prompt. `activate` returns
`instructions: [{ name, text }]` (`InstructionContribution`), next to its tools and hooks.

- **Declared and granted.** Each `name` is listed in the manifest's `instructions`, and the
  manifest lists the `system-prompt:extend` grant; otherwise the activation fails
  (`ExtensionUndeclaredError`, `use: 'instruction'` for a name, `use: 'grant'` for the grant). A
  declared name may go unused. See [manifest](manifest.md#the-system-prompt-grants).
- **Order.** `ActivationResult.contributions.instructions` holds the sections of every extension
  in activation order (dependency order, then the order given), and an extension's own in the order
  it returned them. Two sections with one name, from two extensions or one, collide
  (`ContributionCollisionError`, naming both extensions).
- **No header.** The host adds no heading, label or separator to a section: the extension writes
  its own heading in `text`, and what it wrote is what is held, byte for byte. Putting sections
  into the prompt (and how they are joined) is the caller's job; this package only merges them.
- **The cap.** `text` must be a non-blank string of at most `MAX_INSTRUCTION_CHARS` (4000)
  characters (`@sheavly/extension/instructions/instructions.constants`). An empty, blank or
  non-string text, or a longer one, fails the whole extension with an `ExtensionInstructionError`
  naming the extension, the section and the cap; none of its sections is merged.
- **Frozen copies.** The host reads each name and text once at the check and holds its own frozen
  `{ name, text }` copy in a frozen list. Changing the extension's own objects or array afterwards
  changes nothing the host holds; changing them before the merge, while others activate, fails the
  extension (`ExtensionContributionChangedError`).
- **What is enforced where.** The host enforces the grant, the declared name, the cap, the
  collision and the copy at run time. There is no lint rule. The text's **content** is review-only:
  it is the system prompt, so a section is the most trusted text an extension can write.

### Replacing the generic base

`baseInstructions: string` replaces the generic base of the system prompt only: other extensions'
sections and the app's own instructions still follow it. It needs the `system-prompt:replace`
grant and no manifest name (it is one slot); without the grant the activation fails with an
`ExtensionUndeclaredError` (`use: 'grant'`). It is held to the same text rules and cap as a
section (a blank replacement would silently drop the core guidance, which is the app's choice and
not an extension's), read once and kept as the string. At most one extension per run may contribute
it: a second one fails with a `ContributionCollisionError` naming both, in either order. The
merged value is `contributions.baseInstructions` (`undefined` when none). The replacement text
IS the model's base prompt, and its content is review-only: the host's own base prompt has a
recorded review (`npm run lint:prompt`) that an extension's replacement skips. When the app passes
its own base explicitly, the app's base takes precedence over an extension's replacement.

## Settings

A setting is a static declaration in the extension's manifest, like `name` and `dependsOn`, so the
host can check the user's values before anything activates.

- The manifest's `settings` lists `{ name, type, default, description }`. The name is
  `<extension>.<setting>`, each part lowercase words joined by hyphens, and its prefix is the
  manifest's `name`; `type` is `string`, `number` or `boolean` and `default` has that type
  (see [manifest](manifest.md)).
- `settingKey({ manifest, name, type })` makes the typed `SettingKey<T>` for a declared setting;
  its default and description are the manifest's and `type` is checked against the declared one,
  or an `ExtensionDefinitionError` is thrown. `defineExtension` derives `Extension.settings` from
  the manifest.
- The extension reads its keys in `activate` with `context.settings.get(KEY)`: the user's value if
  the host was given one, otherwise the default. Reading a key the extension did not declare
  throws an `ExtensionSettingError`.
- The app passes the user's values by setting name in `ExtensionHostOptions.settings`. At
  construction (`assertSettings`) the host throws when a value's name is declared by no extension
  (a typo must not pass silently) or when its type differs from the declared one
  (`ExtensionSettingError`). Two extensions cannot declare one name: a setting name starts with
  its extension's name, and extension names are unique.
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
