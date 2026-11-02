# Hooks

Hooks let a host or a project change how the loop works and when context goes in. A hook is a
named object of optional handlers, written with `defineHook` (`@sheavly/core/hook/hook.utils`)
and passed in the loop's `hooks` option.

## Hook points

| Handler          | When                                                    | Can                                                                            |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `sessionStart`   | Once per run, before the first turn                     | Add opening context                                                            |
| `beforeTurn`     | Before each model call                                  | Add context, add system instructions                                           |
| `aroundToolCall` | Around each tool call                                   | Block it, change its input or result (including its `change` / `read` details) |
| `afterTurn`      | After each turn, with its reply and tool results        | Observe, record, fail the run                                                  |
| `onError`        | When the run fails, before the error reaches the caller | Log, report (its own failure is a `hook_failed` event)                         |

Two ways to tell the model something:

- **`addContext`** (`sessionStart`, `beforeTurn`) adds a user message kept in history, emitted as a
  `context_added` event naming the hook. Use it for things that happened ("tests failed").
- **`addInstructions`** (`beforeTurn`) adds system instructions for this turn's model call only.
  They go on `ProviderRequest.instructions` after the run's own `instructions` option, in hook
  order, and are never stored in history. Call it every turn they should apply. Use it for
  standing rules, like AGENTS.md.

## Built-in: AGENTS.md

`createAgentsMdHook({ root, cwd? })` (`src/runtime/agents-md/`) is a `beforeTurn` hook that
reads AGENTS.md files and adds them as system instructions.

- It looks in every folder from `root` down to `cwd` (default: `root`), like git walks up from
  the working directory, and never above `root`. Files go root first, each under its path, so
  the more specific one comes last and wins.
- It re-reads them every turn, so an edit (even the agent's own) applies on the next model call.
- It caps the total at 32,000 characters, with a truncation note. Empty files are skipped.
- The demo passes it first, before the `.sheavly` hooks.

## Order

- Hooks run in the order given. Every handler runs one after another, except `aroundToolCall`,
  which nests: the first hook is outermost. It calls `next()` to continue, `next(input)` to
  change the input (validated as usual), or returns a result without calling it to block.
- A handler that throws fails the run, except `aroundToolCall` (the call gets an error result)
  and `onError`: its failure doesn't stop the other `onError` handlers or replace the run's
  error, but it is reported as a `hook_failed` event (`{ hook, handler, error }`, from a
  `HookError` in `runtime/errors/`).
- A sub-agent run gets only the hooks its parent passes it, and runs its own `sessionStart`.

## Project hooks: `.sheavly/`

```
.sheavly/
  hooks.json        the only required file: { "version": 1, "hooks": [{ "path": "hooks/a.js" }] }
  hooks/            hook files: .js .mjs .cjs .ts .mts .cts, ESM or CommonJS
```

- `loadProjectHooks({ root, trust, grant? })` (`src/runtime/project-hooks/`) loads them once at
  startup, in manifest order (`"enabled": false` skips one), and returns `{ hooks, trust }`.
  Anything broken stops startup with the file name and the reason.
- Each file's default export is the hook (`export default` or `module.exports`). It's validated
  like `defineHook`, so plain JavaScript hooks need nothing installed.
- Node runs TypeScript by removing types: no `enum`, `namespace` or parameter properties.
- Plain `.js` / `.ts` follow the project's package.json `"type"`. A hook in the other format
  fails with a message to rename it (`.cjs` / `.cts` or `.mjs` / `.mts`).
- Hosts pass them inside their own: `hooks: [...hostHooks, ...projectHooks.hooks]`.

### Workspace trust

Hook files are code from the repo, and loading one runs it with the user's full rights: hooks run
in-process, inside the harness, with its env (keys included), and nothing confines what they do
once loaded ([trust model](overview.md#trust-model)). So
`.sheavly/` hooks load only in a workspace the user trusts
([#3](https://github.com/Sheavly/code/issues/3)); otherwise none of their files is
even imported.

- `TrustStore` (`src/runtime/trust/`) keeps the trusted workspaces in one file outside every
  repo, so a repo can't trust itself: `trustStoreFromEnv()` picks `SHEAVLY_TRUST_FILE`, else
  `$XDG_CONFIG_HOME/sheavly/trusted-workspaces.json` (default `~/.config/sheavly/`).
- Each entry is the workspace's real path and a fingerprint (SHA-256) of every file in its
  `.sheavly/` folder when it was trusted. Any later added, removed or edited file there makes it
  `changed`, so new hook code never runs on an old "yes".
- `trust` in the result is `trusted` (hooks loaded), `untrusted` (never trusted), `changed`
  (trusted, but `.sheavly/` changed since) or `no_hooks` (no `hooks.json`; nothing to trust).
- The harness never asks. A host shows `harness.projectTrust` its own way, and trusts the
  workspace when the user says so: `createHarness({ trustWorkspace: true })`, which is the demo's
  `--trust`. The workbook trusts a fresh copy of its committed fixture, and takes `--trust` for a kept or
  continued workspace. Both print `projectTrustNotice` (`terminal-ui/render.utils.ts`) when hooks were skipped.
- A store that can't be read, parsed or written throws a `TrustStoreError` naming the file; it
  is never read as "nothing trusted".

The fingerprint covers `.sheavly/` only, so a trusted hook may import only what it covers: files
whose real path is inside `.sheavly/`, and Node built-ins (`node:fs`). Anything else (`../src/x.js`,
a package, a symlink out of `.sheavly/`, a `require` of either) fails to load with a
`ProjectHooksError`, before its code runs: otherwise a later change to it would run on an old
"yes". `import type` is fine, since Node removes it. This is a Node resolve hook
(`confine.service.ts`), in place for the rest of the process once hooks load.

## Adding a hook point

1. Add an optional handler and its context type to `Hook` in `packages/core/src/hook/hook.types.ts`.
2. Add it to `HANDLERS` in `hook.utils.ts` and to `hookExportSchema` in
   `src/runtime/project-hooks/project-hooks.utils.ts` (the typecheck fails if either is missed).
3. Add a runner in `src/loop/hooks/hooks.service.ts` and call it from the loop.
4. Test it in `src/loop/hooks/__tests__/` and in the loop (`stream-agent/__tests__/hooks.test.ts`).

Not built yet: a user-level `~/.sheavly/`, and
hooks around context compaction (the loop doesn't compact yet). See [#13](https://github.com/Sheavly/code/issues/13).
