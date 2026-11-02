import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const root = tempWorkspace({
  'package.json': { name: '@x/app', workspaces: ['packages/*', 'apps/*'] },
  'packages/protocol/package.json': { name: '@x/protocol' },
  'packages/core/package.json': { name: '@x/core' },
  'packages/coding/package.json': { name: '@x/coding' },
  'packages/testing/package.json': { name: '@x/testing' },
  'apps/cli/package.json': { name: '@x/cli' },
  'apps/web/package.json': { name: '@x/web' },
});
const layout = {
  '@x/protocol': { dir: 'packages/protocol', kind: 'package', domain: 'generic', dependsOn: [] },
  '@x/core': {
    dir: 'packages/core',
    kind: 'package',
    domain: 'generic',
    dependsOn: ['@x/protocol'],
  },
  '@x/coding': {
    dir: 'packages/coding',
    kind: 'package',
    domain: 'coding',
    dependsOn: ['@x/core', '@x/testing'],
  },
  '@x/testing': {
    dir: 'packages/testing',
    kind: 'package',
    domain: 'generic',
    testOnly: true,
    dependsOn: [],
  },
  '@x/cli': { dir: 'apps/cli', kind: 'app', domain: 'coding', dependsOn: ['@x/core', '@x/coding'] },
  '@x/web': { dir: 'apps/web', kind: 'app', domain: 'coding', dependsOn: ['@x/core'] },
  '@x/app': {
    dir: '.',
    kind: 'app',
    domain: 'coding',
    dependsOn: ['@x/core'],
    layers: {
      runtime: ['@x/core'],
      loop: ['@x/core', 'runtime'],
      host: ['@x/core', 'runtime', 'loop'],
      testing: { testOnly: true, dependsOn: ['runtime'] },
    },
  },
};
const at = (file) => path.join(root, file);
const options = [{ root, layout }];
const CORE_FILE = at('packages/core/src/tool/tool.utils.ts');
const CODING_FILE = at('packages/coding/src/files/files.utils.ts');
const LOOP_FILE = at('src/loop/turn.helper.ts');

const error = (messageId) => [{ messageId }];

new RuleTester({ languageOptions: { parser: tseslint.parser } }).run(
  'imports',
  harnessPlugin.rules.imports,
  {
    valid: [
      // Along the graph: down, by package name, and a package importing itself.
      { code: "import { x } from '@x/protocol/a/a.utils';", filename: CORE_FILE },
      { code: "import { x } from '@x/core/tool/tool.utils';", filename: CODING_FILE },
      { code: "import { x } from '@x/core/tool/tool.utils';", filename: CORE_FILE },
      {
        code: "import { x } from '@x/coding/files/files.utils';",
        filename: at('apps/cli/src/main.ts'),
      },
      // Libraries are not ours to check; a relative import inside a workspace is fine.
      { code: "import { z } from 'zod';", filename: CORE_FILE },
      { code: "import { y } from '../message/message.types.js';", filename: CORE_FILE },
      // The test-only package from a test.
      {
        code: "import { fake } from '@x/testing/fake/fake.fake';",
        filename: at('packages/coding/src/files/__tests__/files.utils.test.ts'),
      },
      // The app being split: a layer importing a layer it lists, or its own.
      { code: "import { x } from '../runtime/tasks/tasks.service.js';", filename: LOOP_FILE },
      { code: "import { x } from './sample.helper.js';", filename: LOOP_FILE },
      // Tests and fakes wire concrete pieces: layer rules don't apply to them.
      {
        code: "import { x } from '../../host/host.helper.js';",
        filename: at('src/loop/__tests__/turn.helper.test.ts'),
      },
      {
        code: "import { f } from '../../testing/until.fake.js';",
        filename: at('src/loop/__tests__/a.test.ts'),
      },
    ].map((test) => ({ ...test, options })),
    invalid: [
      // Upward: core importing a package above it.
      {
        code: "import { x } from '@x/coding/files/files.utils';",
        filename: CORE_FILE,
        errors: error('notInGraph'),
      },
      // A package importing an app.
      {
        code: "import { x } from '@x/cli/main';",
        filename: CODING_FILE,
        errors: error('notInGraph'),
      },
      // A generic package importing a coding one.
      {
        code: "export { x } from '@x/coding/files/files.utils';",
        filename: at('packages/protocol/src/a/a.utils.ts'),
        errors: error('notInGraph'),
      },
      // An app importing another app.
      {
        code: "import { x } from '@x/web/main';",
        filename: at('apps/cli/src/main.ts'),
        errors: error('notInGraph'),
      },
      // The test-only package from source.
      {
        code: "import { fake } from '@x/testing/fake/fake.fake';",
        filename: CODING_FILE,
        errors: error('testOnly'),
      },
      // A relative import across workspace roots, from source and from a test.
      {
        code: "import { x } from '../../../core/src/tool/tool.utils.js';",
        filename: CODING_FILE,
        errors: error('crossesWorkspace'),
      },
      {
        code: "import { x } from '../../packages/core/src/tool/tool.utils.js';",
        filename: LOOP_FILE,
        errors: error('crossesWorkspace'),
      },
      // The app being split: a layer importing one it doesn't list, or the test-only layer.
      {
        code: "import { x } from '../host/host.helper.js';",
        filename: LOOP_FILE,
        errors: error('crossesLayer'),
      },
      {
        code: "import('../host/host.helper.js');",
        filename: LOOP_FILE,
        errors: error('crossesLayer'),
      },
      {
        code: "import { f } from '../testing/until.fake.js';",
        filename: LOOP_FILE,
        errors: error('testOnly'),
      },
    ].map((test) => ({ ...test, options })),
  },
);
