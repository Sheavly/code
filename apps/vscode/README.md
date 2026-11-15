# apps/vscode

The VS Code extension goes here: a front end on the harness, like the terminal app
(`apps/terminal`). It isn't built yet.

When it is, it is a workspace created with the scaffold:

```bash
npm run new -- app vscode --domain coding --description "…" --depends-on client,protocol
```

Like the terminal app, it runs in another process than the harness: it makes no choice about a
run (which model, tools and hooks it gets is [the backend's](../backend/README.md)), and reaches
a backend over HTTP with `@sheavly/client`, built from the same `API_ROUTES` as the server. It
reads the stream's `StreamEntry`s and answers approvals through the client, using the wire
contract (`@sheavly/protocol`) and nothing else, never the packages' internals, and nothing
imports it. Until it has a `package.json`, this folder is not a workspace and the layout checks
skip it.
