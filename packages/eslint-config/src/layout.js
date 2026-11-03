// The one part of the workspace layout that code can't tell, written here on purpose: what isn't
// source. Everything else is read from the workspaces themselves (`layout.utils.js`, `readLayout`):
//
//   which workspaces   the root package.json `workspaces`
//   kind               the folder: `packages/*` is a package, `apps/*` an app
//   dependsOn          each workspace's own package.json `dependencies` on other workspaces
//                      (`devDependencies` for its tests)
//   domain, testOnly   each workspace's package.json `sheavly` field, set with
//                      `npm pkg set sheavly.domain=<generic|coding|tooling> -w <dir>` (and
//                      `sheavly.testOnly=true --json` for a test-only one); the scaffold sets it
//
// So a new workspace is covered by being created; nothing here needs an edit for it.

/**
 * TypeScript outside every workspace's `src/` that isn't harness source, each with why: a reviewed
 * exception, never derived. Anything else there fails the layout check (`scripts/check-layout.mjs`).
 */
export const NOT_SOURCE = {
  '*.config.ts': 'root tool configs (Vitest), loaded by the tool, not part of any workspace',
  'workbook/workspaces/**': 'the projects the workbook agent reads and writes, not harness source',
};
