import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import { layoutProblems, readLayout } from '../layout.utils.js';
import { harnessPlugin } from '../plugin.js';
import { tempWorkspace, writeFiles } from '../testing/workspace.fake.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

/** A monorepo whose workspaces are `packages` (folder → manifest fields). */
function repo(packages) {
  return tempWorkspace({
    'package.json': { name: 'monorepo', workspaces: ['packages/*', 'apps/*'] },
    ...Object.fromEntries(
      Object.entries(packages).map(([dir, fields]) => [
        `${dir}/package.json`,
        { name: `@sheavly/${path.basename(dir)}`, ...fields },
      ]),
    ),
  });
}

const generic = { sheavly: { domain: 'generic' } };
const root = repo({
  'packages/base': generic,
  'packages/coding': { sheavly: { domain: 'coding' }, dependencies: { '@sheavly/base': '0' } },
  'packages/bare': {},
  'packages/upward': { ...generic, dependencies: { '@sheavly/coding': '0' } },
  'apps/cli': { sheavly: { domain: 'coding' }, dependencies: { '@sheavly/coding': '0' } },
});
const at = (file) => path.join(root, file);
const options = [{ root }];

describe('readLayout', () => {
  it('derives kind from the folder, dependsOn from package.json and domain from its sheavly field', () => {
    const layout = readLayout({ root });

    expect(layout['@sheavly/coding']).toEqual({
      dir: 'packages/coding',
      kind: 'package',
      domain: 'coding',
      testOnly: false,
      dependsOn: ['@sheavly/base'],
      devDependsOn: [],
      exports: [],
    });
    expect(layout['@sheavly/cli']).toMatchObject({ dir: 'apps/cli', kind: 'app' });
    // The root holds no source, so it is the monorepo around the workspaces, not one of them.
    expect(layout.monorepo).toBeUndefined();
  });

  it('picks up a workspace added after the rule was written, with no edit anywhere else', () => {
    const grown = repo({ 'packages/base': generic });

    writeFiles({
      root: grown,
      files: { 'apps/cli/package.json': { name: '@sheavly/cli', sheavly: { domain: 'coding' } } },
    });

    expect(readLayout({ root: grown })['@sheavly/cli']).toMatchObject({
      kind: 'app',
      domain: 'coding',
    });
  });
});

new RuleTester({ languageOptions: { parser: tseslint.parser } }).run(
  'layout',
  harnessPlugin.rules.layout,
  {
    valid: [
      { code: '', filename: at('packages/base/src/b/b.utils.ts'), options },
      { code: '', filename: at('packages/coding/src/c/c.utils.ts'), options },
      { code: '', filename: at('apps/cli/src/main.ts'), options },
      // Outside every workspace: the layout check reports stray source.
      { code: '', filename: at('tools/gen.ts'), options },
    ],
    invalid: [
      // A workspace without a domain: the message says how to set one.
      {
        code: '',
        filename: at('packages/bare/src/x/x.utils.ts'),
        options,
        errors: [{ messageId: 'broken' }],
      },
      // A generic workspace depending on a coding one.
      {
        code: '',
        filename: at('packages/upward/src/x/x.utils.ts'),
        options,
        errors: [{ messageId: 'broken' }],
      },
    ],
  },
);

describe('layoutProblems', () => {
  const pkg = (fields) => ({
    dir: `packages/${fields.name ?? 'p'}`,
    kind: 'package',
    domain: 'generic',
    testOnly: false,
    dependsOn: [],
    devDependsOn: [],
    ...fields,
  });

  it('says what to run for a missing domain, and names a workspace after its folder', () => {
    expect(layoutProblems({ '@sheavly/p': pkg({ domain: undefined }) })).toEqual([
      '@sheavly/p has no domain: run `npm pkg set sheavly.domain=<generic|coding|tooling> -w packages/p`',
    ]);
    expect(layoutProblems({ '@x/p': pkg({}) })).toEqual([
      '@x/p must be named @sheavly/p, after its folder',
    ]);
    // A root that holds source is a workspace too; npm takes no -w for it.
    expect(
      layoutProblems({ '@sheavly/app': { ...pkg({}), dir: '.', kind: 'app', domain: undefined } }),
    ).toEqual([
      '@sheavly/app has no domain: run `npm pkg set sheavly.domain=<generic|coding|tooling>`',
    ]);
  });

  it('fails an app, a coding workspace from a generic one, or a tooling or test one at runtime', () => {
    const layout = {
      '@sheavly/app': { ...pkg({ name: 'app' }), dir: 'apps/app', kind: 'app' },
      '@sheavly/coding': pkg({ name: 'coding', domain: 'coding' }),
      '@sheavly/lint': pkg({ name: 'lint', domain: 'tooling' }),
      '@sheavly/fakes': pkg({ name: 'fakes', testOnly: true }),
      '@sheavly/a': pkg({
        name: 'a',
        dependsOn: ['@sheavly/app', '@sheavly/coding', '@sheavly/lint', '@sheavly/fakes'],
      }),
    };

    expect(layoutProblems(layout)).toEqual([
      '@sheavly/a depends on @sheavly/app, an app: nothing imports an app',
      '@sheavly/a is generic but depends on @sheavly/coding, a coding workspace',
      '@sheavly/a depends on @sheavly/lint, which source never imports: make it a dev dependency',
      '@sheavly/a depends on @sheavly/fakes, which source never imports: make it a dev dependency',
    ]);
  });

  it('allows any dev dependency below, but never an app, nor coding from a generic one', () => {
    const layout = {
      '@sheavly/lint': pkg({ name: 'lint', domain: 'tooling' }),
      '@sheavly/base': pkg({ name: 'base' }),
      '@sheavly/coding': pkg({ name: 'coding', domain: 'coding' }),
      '@sheavly/cli': { ...pkg({ name: 'cli' }), dir: 'apps/cli', kind: 'app' },
      '@sheavly/a': pkg({
        name: 'a',
        devDependsOn: ['@sheavly/lint', '@sheavly/base', '@sheavly/coding', '@sheavly/cli'],
      }),
    };

    expect(layoutProblems(layout)).toEqual([
      '@sheavly/a is generic but its tests depend on @sheavly/coding, a coding workspace: they must run without a project',
      '@sheavly/a has @sheavly/cli as a dev dependency, an app: nothing imports an app',
    ]);
  });
});

describe("this repo's layout", () => {
  it('holds together, read from the workspaces', () => {
    expect(layoutProblems(readLayout({ root: REPO_ROOT }))).toEqual([]);
  });
});
