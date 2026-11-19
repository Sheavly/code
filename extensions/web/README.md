# @sheavly/web

Public web reading and search tools (web_fetch, web_search), shared with sub-agents.

`createWebExtension({ webFetch, webSearch })` contributes each tool unless its option is `false`.
Search has no default backend: the app selects one (`@sheavly/tools`'s `web-search-backends/`) and
passes it in. The extension depends on `agents` to share its tools with sub-agents. Its
`sheavly.json` names it, that dependency, the `sub-agents` service it requires, the
`sub-agent:share` grant it holds to share and the two tools.

```ts
import { createWebExtension } from '@sheavly/web/web/web.helper';

const web = createWebExtension({ webFetch: {}, webSearch: { backend } });
```

| Module | What it holds                                      |
| ------ | -------------------------------------------------- |
| `web/` | `createWebExtension` and its `WebExtensionOptions` |

## Docs

- [Design](docs/design.md): how it works, and how to extend it.
