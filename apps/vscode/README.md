# apps/vscode

The VS Code extension goes here: a front end on the harness, like `apps/terminal` and
the terminal app (`apps/terminal`). It isn't built yet.

When it is, it is a workspace created with the scaffold:

```bash
npm run new -- app vscode --domain coding --description "…" --depends-on host,coding
```

It talks to the harness only through its public API and the wire contract: `createCodingHarness`
(`@sheavly/coding`), the loop's `AgentEvent`s and the `SessionUpdate` / `ApprovalUpdate` streams
(`@sheavly/protocol`), answering approvals with `approvals.respond`. It never reaches into the
packages' internals, and nothing imports it. Until it has a `package.json`, this folder is not a
workspace and the layout checks skip it.
