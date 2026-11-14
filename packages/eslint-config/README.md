# @sheavly/eslint-config

The shared ESLint config every workspace uses, and the `harness/*` rules that hold the code to
the harness's conventions: file kinds, the import graph, public APIs, one definition per type,
failing loudly. Plain JavaScript that only ESLint loads, so it isn't built; tooling, so a
workspace depends on it as a dev dependency.

```js
// <workspace>/eslint.config.js
import { baseConfig } from '@sheavly/eslint-config';

export default baseConfig({ tsconfigRootDir: import.meta.dirname });
```

| File                | What it holds                                                                |
| ------------------- | ---------------------------------------------------------------------------- |
| `base.js`           | `baseConfig`: every rule, with an app's front-end rules read from its folder |
| `rules/`            | The `harness/*` rules, registered in `plugin.js`                             |
| `file-kinds.js`     | Each `<name>.<kind>.ts` kind and its policy (exports, constants, max lines)  |
| `layout.js`         | `NOT_SOURCE`, the one hand-written part of the layout                        |
| `layout.utils.js`   | `readLayout`: the workspaces, their graph and domains, read from disk        |
| `rule-hints.js`     | `RULE_HINTS`: what to do, added to lint messages that only say what's wrong  |
| `skills.js`         | The one reader of `.agents/skills/*/harness.json`, shared by the hooks       |
| `skill-pointers.js` | `pointRulesToSkills`: appends a skill's guide to the messages of its rules   |

`harness/imports` also keeps modules marked by `sheavly.appOnlyModules` app-selected, while
allowing packages to depend on the workspace's generic API. `harness/layout` validates those
module declarations against actual source folders. See [The workspace layout](docs/layout.md).

A new convention is a rule here, derived from the code rather than a hand-kept list, with a
message that says what to do instead, and RuleTester tests in `src/__tests__/`.

Authored model instructions, templates, tool descriptions and parameter guidance live in
first-class `*.prompt.ts` files: named text/table exports and pure typed rendering functions,
300 lines of code maximum. `harness/prompt-location` traces recognized model-facing sinks through
local bindings, workspace imports, properties and return builders; `harness/kind-contents` and
`harness/pure-imports` enforce the prompt file's shape and mechanical purity. Runtime/user data,
human UI text/errors/status, tests/fakes and stored Markdown prompts are not extraction targets.
See [Prompt extraction](docs/rules.md#prompt-extraction) for supported flows and limitations.

`harness/system-prompt-review` requires an explained review decision when production prompt/tool
sources, their sibling constants, or the generic base prompt change. The dedicated `npm run lint:prompt`
command runs uncached across affected-workspace boundaries. This catches unreviewed source drift,
not semantic prompt correctness; see [System prompt review](docs/rules.md#system-prompt-review).

Typed source checks include `.tsx` components and their tests. React hook rules also check
ordinary source helpers; plain `.ts` tests and fakes are excluded because their lifecycle
helpers use `use*` names too. JSX tests retain the hook rules. See [Rules](docs/rules.md).

## Docs

- [Rules](docs/rules.md): the file kinds and every `harness/*` rule.
- [The workspace layout](docs/layout.md): how the workspaces are read, what the layout check holds
  each one to, public APIs, and the docs it keeps honest.
