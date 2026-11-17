import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { harnessPlugin } from '../plugin.js';
import { ruleIsErrorOn } from '../testing/coding-rule.fake.js';
import { typescriptRuleTester } from '../testing/rule-tester.fake.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const RULE = 'harness/extension-definition';

const manifest = (dir, fields) => ({
  [`${dir}/package.json`]: { name: `@sheavly/${path.basename(dir)}`, ...fields },
});
const generic = { sheavly: { domain: 'generic' } };
const root = tempWorkspace({
  'package.json': { name: 'monorepo', workspaces: ['packages/*', 'extensions/*', 'apps/*'] },
  ...manifest('packages/base', generic),
  ...manifest('extensions/agents', { ...generic, dependencies: { '@sheavly/base': '0' } }),
  ...manifest('extensions/files', { sheavly: { domain: 'coding' } }),
  ...manifest('extensions/solo', generic),
  ...manifest('extensions/web', {
    ...generic,
    dependencies: { '@sheavly/base': '0', '@sheavly/agents': '0' },
    devDependencies: { '@sheavly/files': '0' },
  }),
  ...manifest('extensions/both', {
    ...generic,
    dependencies: { '@sheavly/agents': '0', '@sheavly/solo': '0' },
  }),
  ...manifest('apps/cli', { sheavly: { domain: 'coding' } }),
});
const options = [{ root }];
const at = (file) => path.join(root, file);
const web = at('extensions/web/src/web/web.helper.ts');
const call = (body) => `defineExtension({ ${body}, activate: () => ({}) });`;
const ARRAY = 'array literal of string literals';
const messagesOf = ({ messages }) => messages.map(({ message }) => message);
const problem = (messageId, data) => ({ messageId, ...(data && { data }) });

typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' }).run(
  'extension-definition',
  harnessPlugin.rules['extension-definition'],
  {
    valid: [
      {
        code: call("name: 'web', dependsOn: ['agents']"),
        filename: web,
        options,
      },
      // Absent dependsOn means none.
      {
        code: call("name: 'solo'"),
        filename: at('extensions/solo/src/solo/solo.helper.ts'),
        options,
      },
      {
        code: call("name: 'files', dependsOn: []"),
        filename: at('extensions/files/src/files/files.helper.ts'),
        options,
      },
      // Order does not matter, and a package dependency is not an extension.
      {
        code: call("name: 'both', dependsOn: ['solo', 'agents']"),
        filename: at('extensions/both/src/both/both.helper.ts'),
        options,
      },
      // A quoted key is read like a bare one; web's dev dependency on files is not required.
      {
        code: call("name: 'web', 'dependsOn': ['agents']"),
        filename: web,
        options,
      },
      // Tests, packages and apps are not checked.
      {
        code: call("name: 'other', dependsOn: ['nothing']"),
        filename: at('extensions/web/src/web/__tests__/web.helper.test.ts'),
        options,
      },
      {
        code: call("name: 'other'"),
        filename: at('packages/base/src/b/b.helper.ts'),
        options,
      },
      {
        code: call("name: 'other'"),
        filename: at('apps/cli/src/main.ts'),
        options,
      },
      // Only defineExtension is read.
      { code: "defineThing({ name: 'other' });", filename: web, options },
    ],
    invalid: [
      {
        code: call("name: 'webs', dependsOn: ['agents']"),
        filename: web,
        options,
        errors: [problem('name', { actual: 'webs', expected: 'web' })],
      },
      {
        code: call("name: 'web', dependsOn: []"),
        filename: web,
        options,
        errors: [problem('missing', { package: '@sheavly/agents', name: 'agents' })],
      },
      {
        code: call("name: 'web'"),
        filename: web,
        options,
        errors: [problem('missing', { package: '@sheavly/agents', name: 'agents' })],
      },
      {
        code: call("name: 'web', dependsOn: ['agents', 'ghost']"),
        filename: web,
        options,
        errors: [problem('extra', { name: 'ghost' })],
      },
      // A dev dependency does not make it a dependency.
      {
        code: call("name: 'web', dependsOn: ['agents', 'files']"),
        filename: web,
        options,
        errors: [problem('extra', { name: 'files' })],
      },
      {
        code: call("name: 'web', dependsOn: ['agents', 'agents']"),
        filename: web,
        options,
        errors: [problem('duplicate', { name: 'agents' })],
      },
      {
        code: call("name: 'both', dependsOn: ['agents']"),
        filename: at('extensions/both/src/both/both.helper.ts'),
        options,
        errors: [problem('missing', { package: '@sheavly/solo', name: 'solo' })],
      },
      // Values that cannot be checked are reported, each saying to write a literal.
      {
        code: `const n = 'web'; ${call("name: n, dependsOn: ['agents']")}`,
        filename: web,
        options,
        errors: [problem('notLiteral', { property: 'name', shape: 'string literal' })],
      },
      {
        code: call("dependsOn: ['agents']"),
        filename: web,
        options,
        errors: [problem('notLiteral', { property: 'name', shape: 'string literal' })],
      },
      {
        code: call("name: 'web', dependsOn: DEPENDENCIES"),
        filename: web,
        options,
        errors: [problem('notLiteral', { property: 'dependsOn', shape: ARRAY })],
      },
      {
        code: call("name: 'web', dependsOn: [...BASE, 'agents']"),
        filename: web,
        options,
        errors: [problem('notLiteral', { property: 'dependsOn', shape: ARRAY })],
      },
      {
        code: 'defineExtension(definition);',
        filename: web,
        options,
        errors: [problem('notObject')],
      },
    ],
  },
);

describe('harness/extension-definition is on', () => {
  it('for extension source files, so every declaration is held to its workspace', async () => {
    for (const folder of ['extensions/agents', 'extensions/web', 'extensions/coding']) {
      expect(await ruleIsErrorOn({ rule: RULE, folder, file: 'src/x/x.helper.ts' }), folder).toBe(
        true,
      );
    }
  });

  it('not for extension tests, nor for packages and apps', async () => {
    expect(
      await ruleIsErrorOn({
        rule: RULE,
        folder: 'extensions/web',
        file: 'src/web/__tests__/web.helper.test.ts',
      }),
    ).toBe(false);
    expect(
      await ruleIsErrorOn({ rule: RULE, folder: 'packages/core', file: 'src/x/x.helper.ts' }),
    ).toBe(false);
    expect(
      await ruleIsErrorOn({ rule: RULE, folder: 'apps/backend', file: 'src/x/x.helper.ts' }),
    ).toBe(false);
  });
});

describe("this repo's extensions", () => {
  it('declare the name and dependencies of their workspaces', async () => {
    const eslint = new ESLint({
      cwd: REPO_ROOT,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.ts'],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { tsconfigRootDir: REPO_ROOT },
          },
          plugins: { harness: harnessPlugin },
          rules: { [RULE]: 'error' },
        },
      ],
    });
    const results = await eslint.lintFiles(['extensions/*/src/**/*.ts']);
    const files = results.map(({ filePath }) => path.relative(REPO_ROOT, filePath));

    for (const helper of [
      'extensions/agents/src/agents/agents.helper.ts',
      'extensions/web/src/web/web.helper.ts',
      'extensions/coding/src/extension/coding-extension.helper.ts',
    ]) {
      expect(files).toContain(helper);
    }

    expect(results.flatMap(messagesOf)).toEqual([]);
  });
});
