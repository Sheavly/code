# apps/vscode

The VS Code extension goes here: a front end on the harness, like the terminal app
(`apps/terminal`). It isn't built yet.

When it is, it is a workspace created with the scaffold:

```bash
npm run new -- app vscode --domain coding --description "…" --depends-on coding,providers,tools,workspace
```

Like the terminal app, it composes its own run: it builds the provider (`@sheavly/providers`),
picks the tools and hooks (`@sheavly/coding`, `@sheavly/tools`, `@sheavly/workspace`) and passes
them to `createCodingHarness`. It reads the loop's `AgentEvent`s and the `SessionUpdate` /
`ApprovalUpdate` streams (`@sheavly/protocol`), and answers approvals with `approvals.respond`.
It talks to the harness only through that public API and the wire contract, never reaches into
the packages' internals, and nothing imports it. Until it has a `package.json`, this folder is
not a workspace and the layout checks skip it.
