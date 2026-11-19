import path from 'node:path';
import { CONTRACT_FILES } from '../extension-contract.utils.js';
import { harnessPlugin } from '../plugin.js';
import { EXTENSION_WORKSPACES as workspaces } from '../testing/extension-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const [KEYS_FILE, TYPES_FILE, ERRORS_FILE] = CONTRACT_FILES;
const KEYS = '@sheavly/extension/run-services/run-services.utils';
const TYPES = '@sheavly/extension/run-services/run-services.types';
const ERRORS = '@sheavly/extension/errors/scopes.errors';

const contractFiles = {
  [KEYS_FILE]: `export const SESSION_INFO = defineService<SessionInfoView>('session-info');
export const MODEL = defineService<Provider>('model');`,
  [TYPES_FILE]: `export type SystemPromptView = { readonly text: string };
export type { SessionInfoView, ChildSessionScope } from '@sheavly/runtime/sessions/session-scope.types';
export type { OutputReader } from '@sheavly/core/output/output.types';`,
  [ERRORS_FILE]: 'export class ScopeDeactivatedError extends Error {}',
};
const root = tempWorkspace({ ...workspaces, ...contractFiles });
const options = [{ root }];
const at = (file) => path.join(root, file);
const web = at('extensions/web/src/web/web.helper.ts');
const host = { messageId: 'host' };
const contract = (name, from) => ({ messageId: 'contract', data: { name, path: from } });

const rule = harnessPlugin.rules['extension-public-contract'];
const tester = typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' });

const ALLOWED = [
  `import { SESSION_INFO, MODEL } from '${KEYS}';`,
  `import type { SessionInfoView } from '${TYPES}';`,
  `import { ScopeDeactivatedError } from '${ERRORS}';`,
  `export type { OutputReader } from '${TYPES}';`,
  "import { defineTool } from '@sheavly/core/tool/tool.utils';",
  "import { raise } from '@sheavly/runtime/errors/raise.helper';",
  "import { resolveInside } from '@sheavly/workspace/paths/paths.utils';",
  "import { other } from '@sheavly/agents/agents/agents.helper';",
  "import { SessionInfoView } from './local.types.js';",
  "import { SESSION_INFO } from '../keys.js';",
  "import * as everything from '@sheavly/runtime/sessions/session-scope.types';",
  "import fallback from '@sheavly/runtime/sessions/session-scope.types';",
  "import { Unrelated } from '@sheavly/runtime/sessions/session-scope.types';",
  'const computed = (name) => import(name);',
  'type SessionInfoView = { id: string };',
  'class ScopeDeactivatedError extends Error {}',
];

const SESSION_TYPES = '@sheavly/runtime/sessions/session-scope.types';
const CORE_OUTPUT = '@sheavly/core/output/output.types';
const HOST_KEYS = '@sheavly/host/run-services/run-services.utils';

typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' }).run(
  'extension-public-contract: the supported path',
  rule,
  {
    valid: [
      ...ALLOWED.map((code) => ({ code, filename: web, options })),
      // Tests and fakes are exempt, as for the other extension rules.
      ...[
        'extensions/web/src/web/__tests__/web.helper.test.ts',
        'extensions/web/src/testing/web.fake.ts',
      ].map((file) => ({
        code: `import { SESSION_INFO } from '${HOST_KEYS}';`,
        filename: at(file),
        options,
      })),
      // Only extension source is checked: a package and an app wire the host.
      ...['packages/base/src/b/b.helper.ts', 'apps/cli/src/m.ts'].map((file) => ({
        code: `import { SESSION_INFO } from '${HOST_KEYS}';`,
        filename: at(file),
        options,
      })),
    ],
    invalid: [],
  },
);

tester.run('extension-public-contract: the host', rule, {
  valid: [],
  invalid: [
    `import { SESSION_INFO } from '${HOST_KEYS}';`,
    `import type { Harness } from '@sheavly/host/host/host.types';`,
    "import { a } from '@sheavly/host';",
    "import '@sheavly/host/anything';",
    "import * as host from '@sheavly/host/host/host.helper';",
    "export { x } from '@sheavly/host/instructions/instructions.helper';",
    "export * from '@sheavly/host/instructions/instructions.helper';",
    `const load = () => import('${HOST_KEYS}');`,
    'const load = () => import(`@sheavly/host/a/b`);',
    // The TypeScript forms: a type query, an import type and the import-equals form.
    "type Host = typeof import('@sheavly/host/host/host.helper');",
    "type Harness = import('@sheavly/host/host/host.types').Harness;",
    "import host = require('@sheavly/host/host/host.helper');",
  ].map((code) => ({ code, filename: web, options, errors: [host] })),
});

tester.run('extension-public-contract: contract names from another package', rule, {
  valid: [],
  invalid: [
    {
      code: `import type { SessionInfoView } from '${SESSION_TYPES}';`,
      errors: [contract('SessionInfoView', TYPES)],
    },
    {
      code: `import { type OutputReader } from '${CORE_OUTPUT}';`,
      errors: [contract('OutputReader', TYPES)],
    },
    {
      code: `import { SESSION_INFO as S } from '@sheavly/runtime/keys';`,
      errors: [contract('SESSION_INFO', KEYS)],
    },
    {
      code: "import { ScopeDeactivatedError } from '@sheavly/runtime/errors/scopes.errors';",
      errors: [contract('ScopeDeactivatedError', ERRORS)],
    },
    {
      code: `import { SessionInfoView as View } from '${SESSION_TYPES}';`,
      errors: [contract('SessionInfoView', TYPES)],
    },
    {
      code: `export type { ChildSessionScope as Child } from '${SESSION_TYPES}';`,
      errors: [contract('ChildSessionScope', TYPES)],
    },
    {
      code: `import { MODEL, Fine, SystemPromptView } from '@sheavly/other/x';`,
      errors: [contract('MODEL', KEYS), contract('SystemPromptView', TYPES)],
    },
  ].map((item) => ({ ...item, filename: web, options })),
});

tester.run('extension-public-contract: only the repo packages are checked for names', rule, {
  valid: [
    "import { MODEL, INSTRUCTIONS, SESSION_INFO } from 'some-model-library';",
    "import { SessionInfoView } from 'zod/v4/core';",
    "import { APPROVALS } from '@scope/other-package/keys';",
  ].map((code) => ({ code, filename: web, options })),
  invalid: [],
});

const FAKE = { messageId: 'fake' };

tester.run('extension-public-contract: production takes no test fake', rule, {
  valid: [
    ...[
      "import { a } from './fakery.helper.js';",
      "import { a } from '../testing-library/a.js';",
      "import { a } from 'some-lib/testing/helpers';",
      "import { a } from '@sheavly/extension/extension/extension.utils';",
    ].map((code) => ({ code, filename: web, options })),
    // A test or a fake may import a fake.
    ...[
      'extensions/web/src/web/__tests__/web.helper.test.ts',
      'extensions/web/src/testing/web.fake.ts',
    ].map((file) => ({
      code: "import { a } from '../testing/web.fake.js';",
      filename: at(file),
      options,
    })),
  ],
  invalid: [
    "import * as f from '../testing/coding-run.fake.js';",
    "import type { F } from '../testing/coding-run.fake.js';",
    "import { f } from './run.fake';",
    "import { f } from './run.fake.ts';",
    "import { f } from '../../testing/anything.js';",
    "import { f } from '@sheavly/extension/testing/extension.fake';",
    "import { f } from '@sheavly/workspace/testing/workspace.fake.js';",
    "import { f } from '@sheavly/testing/clock/fixed-clock.fake';",
    "export { f } from '../testing/coding-run.fake.js';",
    "export * from '../testing/coding-run.fake.js';",
    "const load = () => import('../testing/coding-run.fake.js');",
    "type F = typeof import('../testing/coding-run.fake.js');",
    "import f = require('../testing/coding-run.fake.js');",
  ].map((code) => ({ code, filename: web, options, errors: [FAKE] })),
});

// The same package files plus one new exported name per file: the rule reports each with no edit.
const grown = tempWorkspace({
  ...workspaces,
  [KEYS_FILE]: `${contractFiles[KEYS_FILE]}\nexport const NEW_KEY = defineService<Thing>('new');`,
  [TYPES_FILE]: `${contractFiles[TYPES_FILE]}\nexport interface NewView { a: string }`,
  [ERRORS_FILE]: `${contractFiles[ERRORS_FILE]}\nexport class ScopeRevokedError extends Error {}`,
});
const grownCase = (name, from) => ({
  code: `import { ${name} } from '@sheavly/runtime/x';`,
  filename: path.join(grown, 'extensions/agents/src/agents/agents.helper.ts'),
  options: [{ root: grown }],
  errors: [contract(name, from)],
});

tester.run('extension-public-contract: a name added to the package', rule, {
  valid: [],
  invalid: [
    grownCase('NEW_KEY', KEYS),
    grownCase('NewView', TYPES),
    grownCase('ScopeRevokedError', ERRORS),
  ],
});

const bare = tempWorkspace(workspaces);
const bareWeb = path.join(bare, 'extensions/web/src/web/web.helper.ts');
const noFile = { filename: bareWeb, options: [{ root: bare }] };

tester.run('extension-public-contract: without the extension package files', rule, {
  valid: [
    {
      ...noFile,
      code: `import type { SessionInfoView } from '${SESSION_TYPES}';`,
    },
  ],
  invalid: [{ ...noFile, code: `import { a } from '${HOST_KEYS}';`, errors: [host] }],
});
