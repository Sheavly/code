# Packages and workspaces

Which workspace holds what is the `sheavly-packages` skill, generated from the workspaces' `package.json` (`npm run graph`; the layout check fails when it is stale). This guide is how a workspace is kept.

## What a workspace documents

Every workspace documents itself in two layers, and both change with it. Its `README.md` is the first place someone looks: what it is for, its public API (one row per module, matching its `exports`) and a short example, then a `## Docs` list. Its `docs/` folder goes deeper, one topic per file (how it works, why, how to extend it), each linked from the README. The root `docs/` holds only what spans workspaces (`overview.md`, `vision.md`) and the generated index of workspaces (`docs/README.md`).

When you change a workspace's source, update its README or docs in the same change if what they say changed: the stop hook nudges once when a workspace's source changed but neither did. The layout check fails a workspace without a README, with an empty `docs/`, or with a doc its README doesn't link, and any relative link between docs that points at a missing file or heading.

## Layout of the repo

npm workspaces in `packages/` (libraries) and `apps/` (front ends nothing imports). Packages are published, so `exports` is a semver contract: ship only `dist` and `docs`, built by `prepack`. Each is built to its own `dist/` for plain Node (`npm run build`: each workspace's `tsc -b`, in dependency order through turbo); dev, tests and typecheck read its source through the `@sheavly/source` export condition, so nothing is built before `vitest` (`docs/overview.md`, "Packages").

- `packages/protocol`: the wire contract, everything sent to or accepted from a UI. Each type is a zod schema in a `<module>.validator.ts`, its type `z.infer` of it in `<module>.types.ts`. It imports zod only. After changing a schema, run `npm run schema -w @sheavly/protocol`: a test fails while `contract.schema.json` is out of date. What a provider streams and the code contracts (`Tool`, `Hook`, `Adapter`) stay in core.
- `packages/core`: what tools and providers are written against. A new code contract shared by tools and providers goes here; one a UI sees goes in protocol.
- `packages/providers`: the model backends. Only apps import it at runtime: the UI builds the `Provider` and passes it in. One folder per protocol (`responses/`) and per backend (`openai/`, `azure/`); see its README for adding either. Tests that need the real loop with another package's code live in host (`packages/host/src/host/__tests__/`).
- `packages/eslint-config`: `base.js` (the shared config), `file-kinds.js`, `rules/` (the `harness/*` rules, tested with RuleTester in `__tests__/`), `skills.js` (the one reader of the skills' metadata). A new convention is a rule here, used by every workspace.

## A new package or app

`npm run new -- package|app <name> --domain <generic|coding|tooling> --description "…" [--depends-on core,protocol]`. It refuses a dependency the graph doesn't allow, creates the workspace through npm (never a hand-written `package.json`) with its configs and README, and prints the `npm install` to run with each dependency's first import. The layout check fails it until its first module lands, so no workspace stays empty. Make a file kind public with `npm run export -- packages/<pkg> <kind>`.

Never edit `package.json` by hand: use `npm install -D <pkg>` / `npm pkg set`. Domain, test-only and app-only metadata are set the same way.

## Adding a new workspace is covered by being created

Nothing central lists the workspaces: the layout reads the root `package.json` `workspaces`, each `package.json`'s dependencies and its `sheavly` field. If you find yourself editing a list to make a new workspace work, derive the thing from the workspaces instead.
