// The workspace layout as data (#75): every workspace, what kind it is and what it may depend on.
// `harness/layout` reads it on every source file, so a workspace missing from it fails lint, and
// `scripts/check-layout.mjs` holds the files on disk to it.
//
//   kind       `package` (a library other workspaces import) or `app` (a front end or host;
//              nothing imports it)
//   domain     `generic` (no project on disk, no coding tool), `coding` (needs a repo), or
//              `tooling` (config only: source never imports it)
//   dependsOn  the `@sheavly/*` workspaces its source may import
//   testOnly   imported only from tests and fakes (`@sheavly/testing`)
//   layers     for the one app still being split (#29): its `src/` folders and root files, each
//              with what it may import (other layers and packages), so every move is checked.
//              Tests and fakes skip the layer rules: they wire concrete pieces together.
//
// A new workspace, or a new folder in the app being split, is added here in the same change.
const PROTOCOL = '@sheavly/protocol';
const CORE = '@sheavly/core';
const PROVIDERS = '@sheavly/providers';

export const LAYOUT = {
  [PROTOCOL]: { dir: 'packages/protocol', kind: 'package', domain: 'generic', dependsOn: [] },
  [CORE]: { dir: 'packages/core', kind: 'package', domain: 'generic', dependsOn: [PROTOCOL] },
  [PROVIDERS]: {
    dir: 'packages/providers',
    kind: 'package',
    domain: 'generic',
    dependsOn: [PROTOCOL, CORE],
  },
  '@sheavly/eslint-config': {
    dir: 'packages/eslint-config',
    kind: 'package',
    domain: 'tooling',
    dependsOn: [],
  },
  '@sheavly/harness': {
    dir: '.',
    kind: 'app',
    domain: 'coding',
    dependsOn: [PROTOCOL, CORE, PROVIDERS],
    layers: {
      runtime: [PROTOCOL, CORE],
      tools: [PROTOCOL, CORE, 'runtime'],
      loop: [PROTOCOL, CORE, 'runtime'],
      host: [PROTOCOL, CORE, PROVIDERS, 'runtime', 'tools', 'loop'],
      'terminal-ui': [PROTOCOL, CORE, 'runtime', 'tools'],
      workbook: [PROTOCOL, CORE, 'runtime', 'tools', 'loop', 'host', 'terminal-ui'],
      testing: { testOnly: true, dependsOn: [PROTOCOL, CORE, 'runtime'] },
      'demo.ts': ['host', 'loop', 'terminal-ui'],
      'index.ts': [PROTOCOL, CORE, PROVIDERS, 'runtime', 'tools', 'loop', 'host'],
    },
  },
};

/**
 * TypeScript outside every workspace's `src/` that isn't harness source, each with why. Anything
 * else there fails the layout check (`scripts/check-layout.mjs`).
 */
export const NOT_SOURCE = {
  '*.config.ts': 'root tool configs (Vitest), loaded by the tool, not part of any workspace',
  'workbook/workspaces/**': 'the projects the workbook agent reads and writes, not harness source',
};
