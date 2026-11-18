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
  aroundToolCall: async ({ call, next }) => next(), // also: sessionStart, beforeTurn, beforeModelCall, beforeSummary, afterSummary, afterTurn, onError
};
```

- No tsconfig or package.json is needed. For types, `import type { Hook } from '@sheavly/core/hook/hook.types'`
  in TypeScript, or `/** @type {import('@sheavly/core/hook/hook.types').Hook} */` in JavaScript.
- Node runs TypeScript by removing the types: no `enum`, `namespace` or parameter properties.
- `.js` / `.ts` follow your package.json `"type"`. A hook in the other module format fails with
  a message to rename it to `.cjs` / `.cts` or `.mjs` / `.mts`, which load the same everywhere.
- A hook's `name` is yours to choose, with no required prefix, so the coding extension's
  `sheavly.json` declares its hooks with the bare wildcard `"*"`: any name you pick is allowed
  and an installer shows it as hooks whose names are not known in advance. Only a name another
  hook already uses is refused. The bare `"*"` makes the host's hook-name check a no-op for the
  coding extension, and the four names listed beside it in the manifest (`agents-md`, `skills`,
  `scratch`, `working-root`) are documentation, not a limit.
- `loadProjectHooks({ root, trust })` loads them once at startup; pass them after your own hooks
  (`hooks: [...hostHooks, ...projectHooks.hooks]`), so yours wrap the project's.
- **Only in a trusted workspace.** Hook files are code from the repo, so the harness loads none
  until you trust the workspace: run the demo once with `--trust`. It's remembered (outside the
  repo, in `~/.sheavly/trusted-workspaces.json`, or under `SHEAVLY_HOME`) until anything in
  `.sheavly/` changes; then the hooks are skipped again until you review and trust it again. A
  hook may import only files inside `.sheavly/` and Node built-ins, since nothing else is covered
  by that trust. See [Workspace trust](#workspace-trust), below.

## This repo's own hooks

The repo's `.sheavly/` gives a Sheavly run the development guardrails a Cursor chat gets from
`.cursor/hooks/`: `hooks/session-start.mjs` (the `sheavly` skill pointer, and the issue rule when
the opening prompt names none), `hooks/edit-feedback.mjs` (Prettier, ESLint and the first-edit
hints, appended to a file tool's result) and `hooks/shell-guard.mjs` (the shell and git guards on
`run_command`, which fail closed). A hook may import only `.sheavly/` and Node built-ins, so each
runs the Cursor script as a process through `hooks/cursor-bridge.mjs` instead of copying its logic.

- What a project hook cannot do yet: the stop gate, the docs and guide nudges and the subagent
  link need a hook that continues a run and hook points for sub-agents; those stay Cursor-only.
- A hook is not told its conversation, so the scripts' per-chat state (hints shown once, the
  issue a chat named) is one per backend process: once any conversation names an issue, the
  issue rule stays quiet for the rest of that process. `session-start.mjs` scans each new user
  prompt (at `beforeTurn`, once per prompt), so an issue named mid-run is registered for the git
  guard, as `require-issue.mjs` does for a Cursor chat.
- The shell guard fails closed (only an explicit `allow` runs a command; a guard that cannot run
  blocks it), but covers only `run_command`. A command started with `background: true` is checked
  before it runs and not compared afterwards, parallel commands share one snapshot state, and a
  workspace that is not trusted loads no project hook at all, so it has no guard.
- The post-edit hook only checks formatting; unlike a Cursor chat it never rewrites the file,
  because a rewrite after the tool returned would leave the agent's copy stale. It tells the
  agent to run Prettier and re-read the file.
- Known and accepted for now: the trust fingerprint covers `.sheavly/` only, but these hooks run
  `.cursor/hooks/*.mjs`, `packages/eslint-config` and the project's Prettier and ESLint with its
  configs. A change to any of those runs with the user's rights in a workspace that was trusted
  before it, outside the process runner and its approvals.
  The agent can trigger that itself: it can edit `eslint.config.js` or `.cursor/hooks/*` with the
  file tools, and the next file edit then runs the changed code. "No API keys" in the child's
  environment does not put secrets under the user's home folder out of reach of those scripts.
- Other known limits, not fixed here: the shell guard reads the command and a `cwd` as given, and
  the `run_command` tool resolves a relative `cwd` against the working root, which the hook does
  not know; a file that is a symlink, or outside the project, is not linted, and the check-only
  formatting note can name a symlink wrongly; a script's absolute paths can appear in an error the
  agent sees; state files under the user's cache are not cleaned up or written atomically; the
  group kill covers a timeout or an abort only, and is POSIX-only.
- Each script runs as a child process with an allow-listed environment (no API keys), a timeout
  and the run's abort signal, and its whole process group is killed on either.
- Trust costs while developing: the fingerprint covers every file in `.sheavly/`, so each edit
  there needs the workspace trusted again (`--trust`), and each worktree is trusted on its own.
  The backend loads hooks from its `workspace.root`, so a hook only applies to a run in that
  checkout. Tests are in `scripts/__tests__/sheavly-hooks*.test.mjs`, outside `.sheavly/`, so
  editing one does not change the fingerprint.

## Loading them

```
.sheavly/
  hooks.json        the only required file: { "version": 1, "hooks": [{ "path": "hooks/a.js" }] }
  hooks/            hook files: .js .mjs .cjs .ts .mts .cts, ESM or CommonJS
```

- `loadProjectHooks({ root, trust, grant? })` (`@sheavly/coding/project-hooks/`) loads them once at
  startup, in manifest order (`"enabled": false` skips one), and returns `{ hooks, trust }`.
  Anything broken stops startup with the file name and the reason.
- Each file's default export is the hook (`export default` or `module.exports`). It's validated
  like `defineHook`, so plain JavaScript hooks need nothing installed.
- Node runs TypeScript by removing types: no `enum`, `namespace` or parameter properties.
- Plain `.js` / `.ts` follow the project's package.json `"type"`. A hook in the other format
  fails with a message to rename it (`.cjs` / `.cts` or `.mjs` / `.mts`).
- Hosts pass them inside their own: `hooks: [...hostHooks, ...projectHooks.hooks]`, and give the
  same host hooks to `loadProjectHooks({ hostHooks })`. A project hook named like a host hook or
  an earlier project hook stops startup with a `ProjectHooksError` naming both sources.
- **Reload: restart required.** Hooks load once per process and Node caches each module, so a
  change to `.sheavly/` applies on the next start (and, since it changes the fingerprint, needs
  the workspace trusted again). Trust is re-checked right before each hook file is imported, so a
  change made while loading stops the load; it cannot close the gap to the `import()` itself.

## Workspace trust

Hook files are code from the repo, and loading one runs it with the user's full rights: hooks run
in-process, inside the harness, with its env (keys included), and nothing confines what they do
once loaded ([trust model](../../../docs/overview.md#trust-model)). So
`.sheavly/` hooks load only in a workspace the user trusts
([#3](https://github.com/Sheavly/code/issues/3)); otherwise none of their files is
even imported.

- `TrustStore` (`@sheavly/coding/trust/`) keeps the trusted workspaces in one document outside
  every repo, so a repo can't trust itself. It decides what is trusted and not where the document
  lives: the host passes a `TrustPersistence` (`load`, `update`, and the `file` it is in), and the
  store refuses one whose `file` is inside the workspace. The backend gives it a `DocumentFile`
  from `@sheavly/storage` at `trusted-workspaces.json` in the user's folder (`trustStoreFor`:
  `~/.sheavly`, or `SHEAVLY_HOME`). This package
  reads and writes no file of the user's own; a store it cannot read is an error, never "nothing
  trusted".
- Each entry is the workspace's real path and a fingerprint (SHA-256) of every file in its
  `.sheavly/` folder when it was trusted. Any later added, removed or edited file there makes it
  `changed`, so new hook code never runs on an old "yes".
- `trust` in the result is `trusted` (hooks loaded), `untrusted` (never trusted), `changed`
  (trusted, but `.sheavly/` changed since) or `no_hooks` (no `hooks.json`; nothing to trust).
- The harness never asks. A host shows `harness.projectTrust` its own way, and trusts the
  workspace when the user says so: `createBackendHarness({ trustWorkspace: true })`, which is the
  backend's `--trust`. The terminal's workbook trusts a fresh copy of its committed fixture, and takes `--trust` for a kept or
  continued workspace. Both print `projectTrustNotice` (`apps/terminal/src/render/render.utils.ts`) when hooks were skipped.
- A store that can't be read, parsed or written throws a `TrustStoreError` naming the file; it
  is never read as "nothing trusted".

The fingerprint covers `.sheavly/` only, so a trusted hook may import only what it covers: files
whose real path is inside `.sheavly/`, and Node built-ins (`node:fs`). Anything else (`../src/x.js`,
a package, a symlink out of `.sheavly/`, a `require` of either) fails to load with a
`ProjectHooksError`, before its code runs: otherwise a later change to it would run on an old
"yes". `import type` is fine, since Node removes it. This is a Node resolve hook
(`confine.helper.ts`), in place for the rest of the process once hooks load.

`hooks.json` and each hook file are resolved through the same guarded read as a skill's files
(`src/files/guarded-read.helper.ts`). A `.env` file, or a symlink to one, is refused, and so is a
`hooks.json` that links out of `.sheavly/` (it was followed before); a link to another file inside
`.sheavly/` still works. Each refusal is a `ProjectHooksError` that names the file and never its
contents.
