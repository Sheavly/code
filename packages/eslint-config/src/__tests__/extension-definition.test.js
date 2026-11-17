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
  ...manifest('extensions/agents', generic),
  ...manifest('extensions/web', generic),
  ...manifest('apps/cli', { sheavly: { domain: 'coding' } }),
});
const options = [{ root }];
const at = (file) => path.join(root, file);
const web = at('extensions/web/src/web/web.helper.ts');
const READ = "readManifest(new URL('../../sheavly.json', import.meta.url))";
const MODULE = '@sheavly/extension/manifest/manifest.helper';
const IMPORT = `import { readManifest } from '${MODULE}'; `;
const bare = (body) => `defineExtension({ ${body}, activate: () => ({}) });`;
const call = (body) => `${IMPORT}${bare(body)}`;
const withManifest = (body) => call(`manifest: ${READ}${body ? `, ${body}` : ''}`);
const messagesOf = ({ messages }) => messages.map(({ message }) => message);
const problem = (messageId, data) => ({ messageId, ...(data && { data }) });
const unreadable = problem('notReadManifest', { expected: '../../sheavly.json' });

typescriptRuleTester({ sourceType: 'module', ecmaVersion: 'latest' }).run(
  'extension-definition',
  harnessPlugin.rules['extension-definition'],
  {
    valid: [
      { code: withManifest(''), filename: web, options },
      // The manifest read once at module level, as the built-in extensions do.
      {
        code: `const manifest = ${READ}; ${call('manifest')}`,
        filename: web,
        options,
      },
      // The import under another local name is still the manifest helper's `readManifest`.
      {
        code: `import { readManifest as load } from '${MODULE}'; ${bare("manifest: load(new URL('../../sheavly.json', import.meta.url))")}`,
        filename: web,
        options,
      },
      // A quoted key is read like a bare one.
      { code: call(`'manifest': ${READ}`), filename: web, options },
      // The path is resolved from the file: one folder deeper needs one more `../`.
      {
        code: call("manifest: readManifest(new URL('../../../sheavly.json', import.meta.url))"),
        filename: at('extensions/web/src/web/deeper/deeper.helper.ts'),
        options,
      },
      // Tests, packages and apps are not checked.
      {
        code: call("name: 'other', manifest: { name: 'other' }"),
        filename: at('extensions/web/src/web/__tests__/web.helper.test.ts'),
        options,
      },
      { code: call("name: 'other'"), filename: at('packages/base/src/b/b.helper.ts'), options },
      { code: call("name: 'other'"), filename: at('apps/cli/src/main.ts'), options },
      // Only defineExtension is read.
      { code: "defineThing({ name: 'other' });", filename: web, options },
    ],
    invalid: [
      // What the manifest says is never repeated, each reported on its own.
      {
        code: withManifest("name: 'web'"),
        filename: web,
        options,
        errors: [problem('repeated', { property: 'name' })],
      },
      {
        code: withManifest("dependsOn: ['agents']"),
        filename: web,
        options,
        errors: [problem('repeated', { property: 'dependsOn' })],
      },
      {
        code: withManifest('settings: []'),
        filename: web,
        options,
        errors: [problem('repeated', { property: 'settings' })],
      },
      {
        code: withManifest("name: 'web', dependsOn: [], settings: []"),
        filename: web,
        options,
        errors: [
          problem('repeated', { property: 'name' }),
          problem('repeated', { property: 'dependsOn' }),
          problem('repeated', { property: 'settings' }),
        ],
      },
      // The path counts from the file, not the workspace root.
      {
        code: call("manifest: readManifest(new URL('../sheavly.json', import.meta.url))"),
        filename: web,
        options,
        errors: [
          problem('wrongManifest', {
            actual: '../sheavly.json',
            found: 'extensions/web/src/sheavly.json',
            expected: '../../sheavly.json',
          }),
        ],
      },
      {
        code: call("manifest: readManifest(new URL('../../../sheavly.json', import.meta.url))"),
        filename: web,
        options,
        errors: [
          problem('wrongManifest', {
            actual: '../../../sheavly.json',
            found: 'extensions/sheavly.json',
            expected: '../../sheavly.json',
          }),
        ],
      },
      // Another extension's file.
      {
        code: call(
          "manifest: readManifest(new URL('../../../agents/sheavly.json', import.meta.url))",
        ),
        filename: web,
        options,
        errors: [
          problem('wrongManifest', {
            actual: '../../../agents/sheavly.json',
            found: 'extensions/agents/sheavly.json',
            expected: '../../sheavly.json',
          }),
        ],
      },
      // The same mistake through a module-level const is reported where it is read.
      {
        code: `const manifest = readManifest(new URL('../sheavly.json', import.meta.url)); ${call('manifest')}`,
        filename: web,
        options,
        errors: [
          problem('wrongManifest', {
            actual: '../sheavly.json',
            found: 'extensions/web/src/sheavly.json',
            expected: '../../sheavly.json',
          }),
        ],
      },
      // Not a readManifest of a literal path: nothing to check the file against.
      {
        code: call("manifest: { name: 'web' }"),
        filename: web,
        options,
        errors: [unreadable],
      },
      {
        code: `const MANIFEST = '../../sheavly.json'; ${call('manifest: readManifest(new URL(MANIFEST, import.meta.url))')}`,
        filename: web,
        options,
        errors: [unreadable],
      },
      {
        code: call("manifest: readManifest('../../sheavly.json')"),
        filename: web,
        options,
        errors: [unreadable],
      },
      {
        code: call("manifest: readManifest(new URL('../../sheavly.json', base))"),
        filename: web,
        options,
        errors: [unreadable],
      },
      {
        code: call('manifest: readManifest(location)'),
        filename: web,
        options,
        errors: [unreadable],
      },
      // A `readManifest` under another name cannot be told from any other reader.
      {
        code: call("manifest: read(new URL('../../sheavly.json', import.meta.url))"),
        filename: web,
        options,
        errors: [unreadable],
      },
      // `readManifest` must be the import from the manifest helper, not any function of that name.
      {
        code: `function readManifest(url) { return { name: 'web' }; } ${bare(`manifest: ${READ}`)}`,
        filename: web,
        options,
        errors: [unreadable],
      },
      {
        code: `const readManifest = (url) => ({ name: 'web' }); ${bare(`manifest: ${READ}`)}`,
        filename: web,
        options,
        errors: [unreadable],
      },
      {
        code: `import { readManifest } from './elsewhere.js'; ${bare(`manifest: ${READ}`)}`,
        filename: web,
        options,
        errors: [unreadable],
      },
      {
        code: `import { somethingElse as readManifest } from '${MODULE}'; ${bare(`manifest: ${READ}`)}`,
        filename: web,
        options,
        errors: [unreadable],
      },
      {
        code: bare(`manifest: ${READ}`),
        filename: web,
        options,
        errors: [unreadable],
      },
      // A name that is not a module-level const of its own: a parameter, a `let`, an import.
      {
        code: `${IMPORT}export function build(manifest) { return ${bare('manifest')} }`,
        filename: web,
        options,
        errors: [unreadable],
      },
      {
        code: `let manifest = ${READ}; ${call('manifest')}`,
        filename: web,
        options,
        errors: [unreadable],
      },
      {
        code: `import { manifest } from './manifest.js'; ${call('manifest')}`,
        filename: web,
        options,
        errors: [unreadable],
      },
      // No manifest at all.
      {
        code: call("name: 'web'"),
        filename: web,
        options,
        errors: [
          problem('noManifest', { expected: '../../sheavly.json' }),
          problem('repeated', { property: 'name' }),
        ],
      },
      { code: call('foo: 1'), filename: web, options, errors: [problem('noManifest')] },
      // A call that is not a plain object literal cannot be checked.
      {
        code: 'defineExtension(definition);',
        filename: web,
        options,
        errors: [problem('notObject')],
      },
      {
        code: `defineExtension({ ...base, manifest: ${READ} });`,
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
  it('build themselves from the manifest of their workspaces', async () => {
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
