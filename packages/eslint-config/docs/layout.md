# The workspace layout

How the harness reads the workspaces, and what it holds each one to. The rules that check each
file are in [rules.md](rules.md).

## Workspace layout

A new workspace comes from the scaffold, never by hand:

```bash
npm run new -- package <name> --domain <generic|coding|tooling> --description "…" [--depends-on core,protocol]
npm run new -- app <name> --domain <generic|coding|tooling> --description "…" [--depends-on …]
```

It checks each `--depends-on` against the graph first and refuses one it doesn't allow (an app,
coding from generic, a tooling workspace), then creates `packages/<name>` or `apps/<name>` through
`npm init -w` and `npm pkg set` (adding `apps/*` to the root `workspaces` the first time), with its
`eslint.config.js`, `tsconfig.json`, `tsconfig.build.json` and a README, and no code: the layout
check fails it until its first module lands, so no workspace stays empty. An allowed
dependency is installed with its first import (the scaffold prints the `npm install` command):
installed earlier, nothing would import it and knip would fail.

The layout is read from the workspaces, never listed by hand: which workspaces exist from the
root `package.json` `workspaces`, package or app from the folder (`packages/*`, `apps/*`), the graph from each workspace's own `dependencies` (`devDependencies` for its
tests), and its domain from its `sheavly` field (`npm pkg set sheavly.domain=<generic|coding|tooling>`).
Only `NOT_SOURCE` (reviewed exceptions) is written in `packages/eslint-config/src/layout.js`, on
purpose.

`scripts/check-layout.mjs` holds the workspaces to it: each has a domain, is named
`@sheavly/<folder>`, depends on no app, a generic one on
no coding one (its tests neither), and on tooling or test-only ones only as dev dependencies
(tests may use any workspace below, to drive the real code with); each has an
`eslint.config.js` calling `baseConfig` and a `tsconfig.json` extending `tsconfig.base.json` with
`rootDir: "src"`. TypeScript outside a workspace's `src/` fails, apart from what `NOT_SOURCE`
lists with a reason. knip finds the workspaces itself, so `knip.json` lists only the root's
settings. The imports themselves are `harness/imports`.

## Public API

A package's `exports` is its public API, by file kind: `"./*.types": { "@sheavly/source":
"./src/*.types.ts", "default": "./dist/*.types.js" }` makes every `*.types.ts` public, so a new
module needs no entry. Its fakes are `./testing/*`, from source only. `harness/imports` fails an
import of a kind not exported, and `harness/layout` (in lint and the layout check) fails an entry
for one file, a kind that doesn't exist, other targets, fakes exported as a kind, and `exports` on
an app. `npm run export -- packages/<pkg> <kind>` makes a kind public, in review.

## What a run includes is the UI's choice

- `harness/imports` fails a package's source that imports a `*.tool` module other than from a
  tool: only apps and tests put tools together.
- The layout check fails a package that depends at runtime on one holding model backends
  (`*.adapter.ts`): a package takes a `Provider`, and the app builds it.
- Only an app reads env, prints or does terminal I/O; the coverage test checks every package
  source file, so a `files:` override can't carve one out.

## Docs held to the code

The layout check also fails:

- the workspace graph in `docs/overview.md` when it is out of date (`npm run graph` rewrites it),
  and a hand-drawn copy of it in any other doc;
- a path into the root `src/` from before the split into workspaces, an issue number in a
  workspace's source, and a doc that promises what an issue will do.

## Dead code and duplication (knip, jscpd)

- **knip** (`knip.json`) finds unused files, exports, types and dependencies across every
  workspace. Packages are checked at their boundary too (`includeEntryExports`), so a
  `@sheavly/core` export nothing uses fails. `npm run knip`.
- **jscpd** (`.jscpd.json`) finds copied code (50+ tokens over 5+ lines) in `.ts` and `.js`/`.mjs`.
  `npm run jscpd` goes through `scripts/jscpd-runner.mjs`, which fails when `.jscpd.json` is
  missing or unreadable instead of letting jscpd silently scan with its defaults.
- **No baseline.** The repo has no dead code or copied code, so any finding fails, to be fixed
  in code. Never add `jscpd:ignore` comments.
- Remove dead code by hand, or with `npx knip --fix --fix-type exports,types`; never knip's
  `dependencies`/`files` fix types, which edit `package.json` and delete files. Change
  dependencies with `npm install|uninstall`.
