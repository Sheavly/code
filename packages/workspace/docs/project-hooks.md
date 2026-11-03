# Project hooks (`.sheavly/`)

How a project customizes a run with its own hooks, and why they load only in a trusted workspace.

## Writing them

A project customizes the harness with hooks in `.sheavly/`, laid out like `.cursor/`:

```
.sheavly/
  hooks.json          the only required file: which hooks run, in order
  hooks/
    audit.js          JavaScript or TypeScript (.js .mjs .cjs .ts .mts .cts), ESM or CommonJS
```

```json
{
  "version": 1,
  "hooks": [{ "path": "hooks/audit.js" }, { "path": "hooks/x.ts", "enabled": false }]
}
```

A hook file exports the hook as its default (`export default { ... }` or `module.exports = { ... }`):

```js
export default {
  name: 'audit',
  aroundToolCall: async ({ call, next }) => next(), // also: sessionStart, beforeTurn, afterTurn, onError
};
```

- No tsconfig or package.json is needed. For types, `import type { Hook } from '@sheavly/core/hook/hook.types'`
  in TypeScript, or `/** @type {import('@sheavly/core/hook/hook.types').Hook} */` in JavaScript.
- Node runs TypeScript by removing the types: no `enum`, `namespace` or parameter properties.
- `.js` / `.ts` follow your package.json `"type"`. A hook in the other module format fails with
  a message to rename it to `.cjs` / `.cts` or `.mjs` / `.mts`, which load the same everywhere.
- `loadProjectHooks({ root, trust })` loads them once at startup; pass them after your own hooks
  (`hooks: [...hostHooks, ...projectHooks.hooks]`), so yours wrap the project's.
- **Only in a trusted workspace.** Hook files are code from the repo, so the harness loads none
  until you trust the workspace: run the demo once with `--trust`. It's remembered (outside the
  repo, in `~/.config/sheavly/trusted-workspaces.json`, or `SHEAVLY_TRUST_FILE`) until anything in
  `.sheavly/` changes; then the hooks are skipped again until you review and trust it again. A
  hook may import only files inside `.sheavly/` and Node built-ins, since nothing else is covered
  by that trust. See [Workspace trust](#workspace-trust), below.

## Loading them

```
.sheavly/
  hooks.json        the only required file: { "version": 1, "hooks": [{ "path": "hooks/a.js" }] }
  hooks/            hook files: .js .mjs .cjs .ts .mts .cts, ESM or CommonJS
```

- `loadProjectHooks({ root, trust, grant? })` (`@sheavly/workspace/project-hooks/`) loads them once at
  startup, in manifest order (`"enabled": false` skips one), and returns `{ hooks, trust }`.
  Anything broken stops startup with the file name and the reason.
- Each file's default export is the hook (`export default` or `module.exports`). It's validated
  like `defineHook`, so plain JavaScript hooks need nothing installed.
- Node runs TypeScript by removing types: no `enum`, `namespace` or parameter properties.
- Plain `.js` / `.ts` follow the project's package.json `"type"`. A hook in the other format
  fails with a message to rename it (`.cjs` / `.cts` or `.mjs` / `.mts`).
- Hosts pass them inside their own: `hooks: [...hostHooks, ...projectHooks.hooks]`.

## Workspace trust

Hook files are code from the repo, and loading one runs it with the user's full rights: hooks run
in-process, inside the harness, with its env (keys included), and nothing confines what they do
once loaded ([trust model](../../../docs/overview.md#trust-model)). So
`.sheavly/` hooks load only in a workspace the user trusts
([#3](https://github.com/Sheavly/code/issues/3)); otherwise none of their files is
even imported.

- `TrustStore` (`@sheavly/workspace/trust/`) keeps the trusted workspaces in one file outside every
  repo, so a repo can't trust itself: `trustStoreFromEnv(process.env)` (called by the app) picks `SHEAVLY_TRUST_FILE`, else
  `$XDG_CONFIG_HOME/sheavly/trusted-workspaces.json` (default `~/.config/sheavly/`).
- Each entry is the workspace's real path and a fingerprint (SHA-256) of every file in its
  `.sheavly/` folder when it was trusted. Any later added, removed or edited file there makes it
  `changed`, so new hook code never runs on an old "yes".
- `trust` in the result is `trusted` (hooks loaded), `untrusted` (never trusted), `changed`
  (trusted, but `.sheavly/` changed since) or `no_hooks` (no `hooks.json`; nothing to trust).
- The harness never asks. A host shows `harness.projectTrust` its own way, and trusts the
  workspace when the user says so: `createTerminalHarness({ trustWorkspace: true })`, which is the demo's
  `--trust`. The workbook trusts a fresh copy of its committed fixture, and takes `--trust` for a kept or
  continued workspace. Both print `projectTrustNotice` (`apps/terminal/src/render/render.utils.ts`) when hooks were skipped.
- A store that can't be read, parsed or written throws a `TrustStoreError` naming the file; it
  is never read as "nothing trusted".

The fingerprint covers `.sheavly/` only, so a trusted hook may import only what it covers: files
whose real path is inside `.sheavly/`, and Node built-ins (`node:fs`). Anything else (`../src/x.js`,
a package, a symlink out of `.sheavly/`, a `require` of either) fails to load with a
`ProjectHooksError`, before its code runs: otherwise a later change to it would run on an old
"yes". `import type` is fine, since Node removes it. This is a Node resolve hook
(`confine.helper.ts`), in place for the rest of the process once hooks load.
