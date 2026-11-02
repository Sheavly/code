// The two parts of the workspace layout that code can't tell, written here on purpose. Everything
// else is read from the workspaces themselves (`layout.utils.js`, `readLayout`):
//
//   which workspaces   the root package.json `workspaces`
//   kind               the folder: `packages/*` is a package, `apps/*` an app, the root the app
//                      being split (#29)
//   dependsOn          each workspace's own package.json `dependencies` on other workspaces
//                      (`devDependencies` for its tests)
//   domain, testOnly   each workspace's package.json `sheavly` field, set with
//                      `npm pkg set sheavly.domain=<generic|coding|tooling> -w <dir>` (and
//                      `sheavly.testOnly=true --json` for a test-only one); the scaffold sets it
//
// So a new workspace is covered by being created; nothing here needs an edit for it.

const PROTOCOL = '@sheavly/protocol';
const CORE = '@sheavly/core';
const PROVIDERS = '@sheavly/providers';
const RUNTIME = '@sheavly/runtime';
const TOOLS = '@sheavly/tools';
const LOOP = '@sheavly/loop';
const HOST = '@sheavly/host';
const WORKSPACE = '@sheavly/workspace';
const CODING = '@sheavly/coding';

/**
 * The app being split (#29): its `src/` folders and root files, each with what it may import
 * (other layers and the workspaces the app depends on). A policy, not a fact of the code: which
 * layer may import which is decided here, in review. A src/ folder or root file that isn't one of
 * them fails `harness/layout`. Tests and fakes skip the layer rules: they wire concrete pieces
 * together. Goes away when the last folder becomes a workspace.
 */
export const SPLIT_APP = {
  dir: '.',
  layers: {
    // What is left in src/runtime: the workbook's errors, which move with the workbook app.
    runtime: [RUNTIME],
    'terminal-ui': [PROTOCOL, CORE, RUNTIME, WORKSPACE, CODING],
    workbook: [PROTOCOL, CORE, RUNTIME, HOST, WORKSPACE, CODING, LOOP, 'runtime', 'terminal-ui'],
    'demo.ts': [HOST, CODING, LOOP, 'terminal-ui'],
    'index.ts': [PROTOCOL, CORE, PROVIDERS, RUNTIME, TOOLS, HOST, WORKSPACE, CODING, LOOP],
  },
};

/**
 * TypeScript outside every workspace's `src/` that isn't harness source, each with why: a reviewed
 * exception, never derived. Anything else there fails the layout check (`scripts/check-layout.mjs`).
 */
export const NOT_SOURCE = {
  '*.config.ts': 'root tool configs (Vitest), loaded by the tool, not part of any workspace',
  'workbook/workspaces/**': 'the projects the workbook agent reads and writes, not harness source',
};
