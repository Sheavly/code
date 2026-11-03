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

| File              | What it holds                                                                |
| ----------------- | ---------------------------------------------------------------------------- |
| `base.js`         | `baseConfig`: every rule, with an app's front-end rules read from its folder |
| `rules/`          | The `harness/*` rules, registered in `plugin.js`                             |
| `file-kinds.js`   | Each `<name>.<kind>.ts` kind and its policy (exports, classes, max lines)    |
| `layout.js`       | `NOT_SOURCE`, the one hand-written part of the layout                        |
| `layout.utils.js` | `readLayout`: the workspaces, their graph and domains, read from disk        |

A new convention is a rule here, derived from the code rather than a hand-kept list, with a
message that says what to do instead, and RuleTester tests in `src/__tests__/`.

## Docs

- [Rules](docs/rules.md): the file kinds and every `harness/*` rule.
- [The workspace layout](docs/layout.md): how the workspaces are read, what the layout check holds
  each one to, public APIs, and the docs it keeps honest.
