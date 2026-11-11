import path from 'node:path';
import { harnessPlugin } from '../plugin.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

// Unrelated names ensure this policy follows metadata, not today's tools or backend names.
const root = tempWorkspace({
  'package.json': { name: 'monorepo', workspaces: ['packages/*', 'apps/*'] },
  'packages/pieces/package.json': {
    name: '@x/pieces',
    sheavly: { domain: 'generic', appOnlyModules: ['selected', 'other-selected'] },
    exports: {
      './*.helper': { '@sheavly/source': './src/*.helper.ts' },
      './*.types': { '@sheavly/source': './src/*.types.ts' },
      './testing/*': { '@sheavly/source': './src/testing/*.ts' },
    },
  },
  'packages/pieces/src/selected/selected.helper.ts': '',
  'packages/pieces/src/other-selected/other-selected.helper.ts': '',
  'packages/consumer/package.json': {
    name: '@x/consumer',
    sheavly: { domain: 'generic' },
    dependencies: { '@x/pieces': '0' },
  },
  'packages/fakes/package.json': {
    name: '@x/fakes',
    sheavly: { domain: 'generic', testOnly: true },
    dependencies: { '@x/pieces': '0' },
  },
  'apps/ui/package.json': {
    name: '@x/ui',
    sheavly: { domain: 'generic' },
    dependencies: { '@x/pieces': '0' },
  },
});
const at = (file) => path.join(root, file);
const consumer = at('packages/consumer/src/consumer/consumer.helper.ts');
const samePackage = at('packages/pieces/src/neutral/neutral.tool.ts');
const selected = at('packages/pieces/src/selected/selected.helper.ts');
const options = [{ root }];
const backendImport = "import { create } from '@x/pieces/selected/selected.helper';";

typescriptRuleTester().run('app-only imports', harnessPlugin.rules.imports, {
  valid: [
    { code: backendImport, filename: at('apps/ui/src/main/main.helper.ts') },
    {
      code: backendImport,
      filename: at('packages/consumer/src/consumer/__tests__/consumer.helper.test.ts'),
    },
    { code: backendImport, filename: at('packages/consumer/src/testing/consumer.fake.ts') },
    { code: backendImport, filename: at('packages/fakes/src/fetch/fetch.fake.ts') },
    { code: "import { create } from './internal.helper.js';", filename: selected },
    { code: backendImport, filename: selected },
    { code: "import { contract } from '@x/pieces/neutral/neutral.helper';", filename: consumer },
    {
      code: "import type { Options } from '@x/pieces/selected/selected.types';",
      filename: consumer,
    },
    {
      code: "import { type Options } from '@x/pieces/selected/selected.types';",
      filename: consumer,
    },
    {
      code: "import type { Options } from '../selected/selected.types.js';",
      filename: samePackage,
    },
    {
      code: "export type { Options } from '@x/pieces/selected/selected.types';",
      filename: consumer,
    },
    {
      code: "export { type Options } from '@x/pieces/selected/selected.types';",
      filename: consumer,
    },
    { code: "export type * from '@x/pieces/selected/selected.types';", filename: consumer },
  ].map((test) => ({ ...test, options })),
  invalid: [
    { code: backendImport, filename: consumer },
    { code: backendImport, filename: samePackage },
    { code: "import { create } from '../selected/selected.helper.js';", filename: samePackage },
    { code: "import '../selected/selected.helper.js';", filename: samePackage },
    { code: "import '@x/pieces/selected/selected.helper';", filename: consumer },
    { code: "export { create } from '@x/pieces/selected/selected.helper';", filename: consumer },
    { code: "export * from '@x/pieces/selected/selected.helper';", filename: consumer },
    { code: "export { create } from '../selected/selected.helper.js';", filename: samePackage },
    { code: "export * from '../selected/selected.helper.js';", filename: samePackage },
    { code: "const backend = import('@x/pieces/selected/selected.helper');", filename: consumer },
    { code: "const backend = import('../selected/selected.helper.js');", filename: samePackage },
    {
      code: "import { type Options, create } from '@x/pieces/selected/selected.helper';",
      filename: consumer,
    },
    {
      code: "export { type Options, create } from '@x/pieces/selected/selected.helper';",
      filename: consumer,
    },
    // A selected module cannot use the self-internal exception to select a different module.
    {
      code: "import { create } from '../other-selected/other-selected.helper.js';",
      filename: selected,
    },
    {
      code: "import { create } from '@x/pieces/other-selected/other-selected.helper';",
      filename: selected,
    },
    // Normalization cannot hide the target folder from the policy.
    {
      code: "import { create } from '../neutral/../selected/selected.helper.js';",
      filename: samePackage,
    },
  ].map((test) => ({ ...test, options, errors: [{ messageId: 'appOnlyModule' }] })),
});
