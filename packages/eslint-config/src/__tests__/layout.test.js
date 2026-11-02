import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import { LAYOUT } from '../layout.js';
import { layoutProblems, listWorkspaces } from '../layout.utils.js';
import { harnessPlugin } from '../plugin.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

/** A workspace on disk: `files` relative to its root, JSON for objects. */

const root = tempWorkspace({
  'package.json': { name: '@x/app', workspaces: ['packages/*'] },
  'packages/base/package.json': { name: '@x/base' },
  'packages/stray/package.json': { name: '@x/stray' },
});
const layout = {
  '@x/base': { dir: 'packages/base', kind: 'package', domain: 'generic', dependsOn: [] },
  '@x/app': { dir: '.', kind: 'app', domain: 'coding', dependsOn: ['@x/base'] },
};
const at = (file) => path.join(root, file);
const options = [{ root, layout }];

new RuleTester({ languageOptions: { parser: tseslint.parser } }).run(
  'layout',
  harnessPlugin.rules.layout,
  {
    valid: [
      { code: '', filename: at('src/a/a.utils.ts'), options },
      { code: '', filename: at('packages/base/src/b/b.utils.ts'), options },
    ],
    invalid: [
      // A workspace on disk the layout doesn't list.
      {
        code: '',
        filename: at('packages/stray/src/s/s.utils.ts'),
        options,
        errors: [{ messageId: 'missing' }],
      },
      // A layout that doesn't hold together fails every file until it is fixed.
      {
        code: '',
        filename: at('src/a/a.utils.ts'),
        options: [
          {
            root,
            layout: { ...layout, '@x/base': { ...layout['@x/base'], dependsOn: ['@x/app'] } },
          },
        ],
        errors: [{ messageId: 'broken' }],
      },
    ],
  },
);

describe('layoutProblems', () => {
  const pkg = (fields) => ({
    dir: 'packages/p',
    kind: 'package',
    domain: 'generic',
    dependsOn: [],
    ...fields,
  });

  it('passes a graph that points down', () => {
    expect(layoutProblems(layout)).toEqual([]);
  });

  it('fails a workspace importing an app, generic importing coding, tooling or an unknown one', () => {
    expect(
      layoutProblems({
        '@x/app': { dir: '.', kind: 'app', domain: 'coding', dependsOn: [] },
        '@x/coding': pkg({ domain: 'coding' }),
        '@x/lint': pkg({ domain: 'tooling' }),
        '@x/a': pkg({ dependsOn: ['@x/app'] }),
        '@x/b': pkg({ dependsOn: ['@x/coding'] }),
        '@x/c': pkg({ dependsOn: ['@x/lint'] }),
        '@x/d': pkg({ dependsOn: ['@x/gone'] }),
      }),
    ).toEqual([
      '@x/a depends on @x/app, an app: nothing imports an app',
      '@x/b is generic but depends on @x/coding, a coding workspace',
      '@x/c depends on @x/lint, a tooling workspace: source never imports it',
      "@x/d depends on @x/gone, which the layout doesn't list",
    ]);
  });

  it("fails a layer that imports what its app doesn't depend on, or no layer at all", () => {
    expect(
      layoutProblems({
        ...layout,
        '@x/other': pkg({}),
        '@x/app': {
          ...layout['@x/app'],
          layers: { tools: ['@x/other'], loop: ['tools', 'nowhere'] },
        },
      }),
    ).toEqual([
      "@x/app's layer tools imports @x/other, which @x/app doesn't depend on",
      "@x/app's layer loop imports nowhere, which is neither a layer nor a workspace",
    ]);
  });

  it('fails an unknown kind or domain', () => {
    expect(layoutProblems({ '@x/a': pkg({ kind: 'lib', domain: 'misc' }) })).toEqual([
      '@x/a has kind lib',
      '@x/a has domain misc',
    ]);
  });
});

describe("this repo's layout", () => {
  it('holds together', () => {
    expect(layoutProblems(LAYOUT)).toEqual([]);
  });

  it('lists every workspace on disk, at its directory', () => {
    const onDisk = listWorkspaces(REPO_ROOT).map(({ name, relative }) => [name, relative]);

    expect(onDisk.filter(([name, relative]) => LAYOUT[name]?.dir !== relative)).toEqual([]);
  });
});
