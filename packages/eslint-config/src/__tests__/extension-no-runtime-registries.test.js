import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HARNESS_TYPES_FILE } from '../harness-registry-types.utils.js';
import { harnessPlugin } from '../plugin.js';
import { repoRuleLinter, ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const RULE = 'harness/extension-no-runtime-registries';
const SESSIONS = '@sheavly/runtime/sessions/sessions.service';
const TASKS = '@sheavly/runtime/tasks/tasks.service';
const APPROVALS = '@sheavly/runtime/approvals/approvals.service';
const HOST_HELPER = '@sheavly/host/host/host.helper';

const HOST_TYPES = `
import type { Provider } from '@sheavly/core/provider/provider.types';
import type { ApprovalRegistry } from '${APPROVALS}';
import type { SessionRegistry } from '${SESSIONS}';
import type { TaskRegistry } from '${TASKS}';
export type Harness = { provider: Provider; sessions: SessionRegistry; tasks: TaskRegistry; approvals: ApprovalRegistry };
`;
const manifest = (name, domain) => ({ name, sheavly: { domain } });
const workspaces = {
  'package.json': { name: 'monorepo', workspaces: ['apps/*', 'extensions/*', 'packages/*'] },
  'apps/cli/package.json': manifest('@sheavly/cli', 'coding'),
  'extensions/web/package.json': manifest('@sheavly/web', 'generic'),
  'packages/base/package.json': manifest('@sheavly/base', 'generic'),
};
const root = tempWorkspace({ ...workspaces, [HARNESS_TYPES_FILE]: HOST_TYPES });
const bare = tempWorkspace(workspaces);
const options = [{ root }];
const at = (file) => path.join(root, file);
const web = at('extensions/web/src/web/web.helper.ts');
const runtime = (module) => ({ messageId: 'runtime', data: { module } });

const VALUE_USES = [
  [`import { SessionRegistry } from '${SESSIONS}';`, SESSIONS],
  [`import { TaskRegistry } from '${TASKS}';`, TASKS],
  [`import { ApprovalRegistry } from '${APPROVALS}';`, APPROVALS],
  [`import { createHarness } from '${HOST_HELPER}';`, HOST_HELPER],
  [`import { createHarness } from '${HOST_HELPER}.js';`, HOST_HELPER],
  [`import * as sessions from '${SESSIONS}';`, SESSIONS],
  [`import '${TASKS}';`, TASKS],
  [`import { type A, B } from '${TASKS}';`, TASKS],
  [`export { TaskRegistry } from '${TASKS}';`, TASKS],
  [`export { type A, B } from '${TASKS}';`, TASKS],
  [`export * from '${SESSIONS}';`, SESSIONS],
  [`export * as all from '${SESSIONS}';`, SESSIONS],
  [`const load = () => import('${APPROVALS}');`, APPROVALS],
  [`const load = () => import(\`${APPROVALS}\`);`, APPROVALS],
  [`const sessions = require('${SESSIONS}');`, SESSIONS],
  [`import sessions = require('${SESSIONS}');`, SESSIONS],
  // The same module spelled another way: a relative path into the workspace, `..` inside a
  // package specifier.
  [
    "import { TaskRegistry } from '../../../../packages/runtime/src/tasks/tasks.service.js';",
    TASKS,
  ],
  ["export * from '../../../base/src/x/../../../runtime/src/sessions/sessions.service';", SESSIONS],
  [`import { TaskRegistry } from '@sheavly/runtime/sessions/../tasks/tasks.service';`, TASKS],
  [`const load = () => import('@sheavly/runtime/./approvals/approvals.service.js');`, APPROVALS],
];
const ALLOWED = [
  `import type { SessionRegistry } from '${SESSIONS}';`,
  `import type { TaskRegistry } from '${TASKS}';`,
  `import type * as All from '${TASKS}';`,
  `import { type SessionRegistry } from '${SESSIONS}';`,
  `import { type A, type B } from '${TASKS}';`,
  `export type { TaskRegistry } from '${TASKS}';`,
  `export { type TaskRegistry } from '${TASKS}';`,
  `export type * from '${SESSIONS}';`,
  `import type { createHarness } from '${HOST_HELPER}';`,
  `import sessions = require('other');`,
  "import { startWork, finiteWork } from '@sheavly/runtime/tasks/work.utils';",
  "import type { WorkDefinition } from '@sheavly/runtime/tasks/work.types';",
  "import { WorkDefinition } from '@sheavly/runtime/tasks/work.types';",
  "import { composeInstructions } from '@sheavly/host/instructions/instructions.helper';",
  "import { a } from './local.helper.js';",
  "import { a } from '../../../../packages/runtime/src/tasks/work.utils.js';",
  "import { a } from '@sheavly/runtime/tasks/../tasks/work.utils';",
  "const other = require('node:path');",
  'const computed = (name) => import(name);',
  'const dynamic = (name) => require(name);',
];

typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' }).run(
  'extension-no-runtime-registries',
  harnessPlugin.rules['extension-no-runtime-registries'],
  {
    valid: [
      ...ALLOWED.map((code) => ({ code, filename: web, options })),
      // Test and fake files are exempt.
      ...[
        'extensions/web/src/web/__tests__/web.helper.test.ts',
        'extensions/web/src/testing/web.fake.ts',
      ].map((file) => ({
        code: `import { createHarness } from '${HOST_HELPER}';`,
        filename: at(file),
        options,
      })),
      // Only extension source is checked: a package and an app may hold the registries.
      ...['packages/base/src/b/b.helper.ts', 'apps/cli/src/m.ts'].map((file) => ({
        code: `import { createHarness } from '${HOST_HELPER}';\nimport { TaskRegistry } from '${TASKS}';`,
        filename: at(file),
        options,
      })),
    ],
    invalid: [
      ...VALUE_USES.map(([code, module]) => ({
        code,
        filename: web,
        options,
        errors: [runtime(module)],
      })),
      // The option set takes no `allow`: there is no exception to name.
      {
        code: `import { a } from '${SESSIONS}';\nexport * from '${TASKS}';`,
        filename: web,
        options,
        errors: [runtime(SESSIONS), runtime(TASKS)],
      },
      // Without a readable `Harness` type there is nothing to check against, and it says so.
      {
        code: 'export const a = 1;',
        filename: path.join(bare, 'extensions/web/src/web/web.helper.ts'),
        options: [{ root: bare }],
        errors: [{ messageId: 'unreadable', data: { file: HARNESS_TYPES_FILE } }],
      },
    ],
  },
);

/** The rule's messages for one linted file, each with the file's path from the repo root. */
function violationsOf(result) {
  const file = path.relative(REPO_ROOT, result.filePath);

  return result.messages
    .filter((message) => message.ruleId === RULE)
    .map((message) => `${file}: ${message.message}`);
}

describe('the rule has no exceptions, over this repo', () => {
  const eslint = repoRuleLinter(RULE);

  it('finds no violation in the source of any extension', async () => {
    const results = await eslint.lintFiles(['extensions/*/src/**/*.ts']);

    expect(results.flatMap(violationsOf)).toEqual([]);
  });

  it('fails a file shaped like a harness builder: a value import of createHarness', async () => {
    const [result] = await eslint.lintText(
      `import { createHarness } from '${HOST_HELPER}';\nexport const harness = createHarness({});`,
      { filePath: path.join(REPO_ROOT, 'extensions/coding/src/extension/coding.helper.ts') },
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.ruleId).toBe(RULE);
    expect(result.messages[0]?.message).toContain(HOST_HELPER);
  });

  it("reports a registry import in any extension file, with this repo's own host types", async () => {
    const [result] = await eslint.lintText(`import { TaskRegistry } from '${TASKS}';`, {
      filePath: path.join(REPO_ROOT, 'extensions/web/src/web/not-listed.helper.ts'),
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message).toContain(TASKS);
  });
});

describe('harness/extension-no-runtime-registries is on', () => {
  const where = [
    ['extensions/agents', 'src/x/x.helper.ts', true],
    ['extensions/web', 'src/x/x.helper.ts', true],
    ['extensions/coding', 'src/x/x.helper.ts', true],
    ['extensions/web', 'src/web/__tests__/web.helper.test.ts', false],
    ['packages/host', 'src/x/x.helper.ts', false],
    ['apps/backend', 'src/x/x.helper.ts', false],
  ];

  it.each(where)('%s %s: %s', async (...row) => {
    const [folder, file, expected] = row;

    expect(await ruleIsErrorOn({ rule: RULE, folder, file })).toBe(expected);
  });
});
