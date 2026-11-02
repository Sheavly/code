import { afterEach, describe, expect, it } from 'vitest';
import { findLayoutProblems } from '../check-layout.mjs';
import { createTempRepo, REPO_ROOT, removeTempRepos } from './temp-repo.utils.mjs';
import { spawnSync } from 'node:child_process';

afterEach(removeTempRepos);

const TSCONFIG =
  '{\n  // comments are allowed\n  "extends": "../../tsconfig.base.json",\n  "compilerOptions": { "rootDir": "src" }\n}\n';
const ESLINT =
  "import { baseConfig } from '@sheavly/eslint-config';\n\nexport default baseConfig({ tsconfigRootDir: import.meta.dirname });\n";
const json = (value) => JSON.stringify(value);

/** A workspace that passes every check: `@sheavly/<folder>` with its files and entries. */
function wellFormed(folder, manifest = {}) {
  return {
    [`packages/${folder}/package.json`]: json({ name: `@sheavly/${folder}`, ...manifest }),
    [`packages/${folder}/eslint.config.js`]: ESLINT,
    [`packages/${folder}/tsconfig.json`]: TSCONFIG,
    [`packages/${folder}/src/${folder}/${folder}.utils.ts`]: 'export const x = 1;\n',
  };
}

const LAYOUT = {
  '@sheavly/app': { dir: '.', kind: 'app', domain: 'coding', dependsOn: [], layers: {} },
  '@sheavly/base': { dir: 'packages/base', kind: 'package', domain: 'generic', dependsOn: [] },
  '@sheavly/lint': { dir: 'packages/lint', kind: 'package', domain: 'tooling', dependsOn: [] },
  '@sheavly/top': {
    dir: 'packages/top',
    kind: 'package',
    domain: 'generic',
    dependsOn: ['@sheavly/base'],
  },
};
const KNIP = {
  workspaces: { '.': {}, 'packages/base': {}, 'packages/lint': {}, 'packages/top': {} },
};

function repo(overrides = {}) {
  const files = {
    'package.json': json({ name: '@sheavly/app', workspaces: ['packages/*'] }),
    'eslint.config.js': ESLINT,
    'tsconfig.json': json({ extends: './tsconfig.base.json', compilerOptions: { rootDir: 'src' } }),
    'src/main.ts': 'export {};\n',
    'knip.json': json(KNIP),
    ...wellFormed('base'),
    ...wellFormed('lint'),
    ...wellFormed('top', {
      dependencies: { '@sheavly/base': '^0.0.0' },
      devDependencies: { '@sheavly/lint': '^0.0.0' },
    }),
    ...overrides,
  };
  const root = createTempRepo(
    Object.fromEntries(Object.entries(files).filter(([, content]) => content !== null)),
  );

  return { root, files: Object.keys(files).filter((file) => files[file] !== null) };
}

const problems = (overrides, layout = LAYOUT, notSource = {}) =>
  findLayoutProblems({ ...repo(overrides), layout, notSource });

describe('the layout check', () => {
  it('passes workspaces that follow the layout', () => {
    expect(problems()).toEqual([]);
  });

  it('fails a hand-made workspace with no layout entry', () => {
    expect(problems(wellFormed('stray'))).toEqual([
      expect.stringContaining(
        '@sheavly/stray has no entry in packages/eslint-config/src/layout.js',
      ),
    ]);
  });

  it('fails a workspace not named after its folder, or listed at another directory', () => {
    const layout = { ...LAYOUT, '@sheavly/other': { ...LAYOUT['@sheavly/base'] } };

    expect(
      problems({ 'packages/base/package.json': json({ name: '@sheavly/other' }) }, layout),
    ).toEqual([expect.stringContaining('name it @sheavly/base')]);
    expect(
      problems(
        {},
        { ...LAYOUT, '@sheavly/base': { ...LAYOUT['@sheavly/base'], dir: 'packages/x' } },
      ),
    ).toEqual([expect.stringContaining('the layout puts @sheavly/base at packages/x')]);
  });

  it.each([
    ['no eslint.config.js', { 'packages/base/eslint.config.js': null }, 'must call baseConfig'],
    [
      'an eslint.config.js without baseConfig',
      { 'packages/base/eslint.config.js': 'export default [];\n' },
      'must call baseConfig',
    ],
    ['no tsconfig.json', { 'packages/base/tsconfig.json': null }, 'tsconfig.json is missing'],
    [
      'a tsconfig.json not extending the base',
      { 'packages/base/tsconfig.json': json({ compilerOptions: { rootDir: 'src' } }) },
      'must extend',
    ],
    [
      'a tsconfig.json without rootDir',
      { 'packages/base/tsconfig.json': json({ extends: '../../tsconfig.base.json' }) },
      '"rootDir": "src"',
    ],
    [
      'no knip.json entry',
      { 'knip.json': json({ workspaces: { '.': {}, 'packages/lint': {}, 'packages/top': {} } }) },
      'knip.json',
    ],
  ])('fails a workspace with %s', (_, overrides, message) => {
    expect(problems(overrides)).toEqual([expect.stringContaining(message)]);
  });

  it('fails dependencies off the graph: missing, extra, or a dev dependency that is not tooling', () => {
    const top = (manifest) => ({
      'packages/top/package.json': json({ name: '@sheavly/top', ...manifest }),
    });

    expect(problems(top({}))).toEqual([
      expect.stringContaining("package.json doesn't depend on it"),
    ]);
    expect(problems(top({ dependencies: { '@sheavly/base': '0', '@sheavly/lint': '0' } }))).toEqual(
      [
        expect.stringContaining(
          "depends on @sheavly/lint, which its layout entry's dependsOn doesn't list",
        ),
      ],
    );
    expect(
      problems(
        top({ dependencies: { '@sheavly/base': '0' }, devDependencies: { '@sheavly/base': '0' } }),
      ),
    ).toEqual([expect.stringContaining('only tooling and test-only workspaces may be')]);
  });

  it("fails source outside every workspace's src/, unless NOT_SOURCE says why", () => {
    const stray = { 'tools/gen.ts': 'export {};\n', 'fixtures/app/.hidden/x.cts': 'export {};\n' };

    expect(problems(stray)).toEqual([
      expect.stringContaining('tools/gen.ts: source lives in a workspace'),
      expect.stringContaining('fixtures/app/.hidden/x.cts: source lives in a workspace'),
    ]);
    expect(
      problems(stray, LAYOUT, { 'tools/*.ts': 'generated', 'fixtures/**': 'a fixture' }),
    ).toEqual([]);
  });
});

describe("this repo's layout", () => {
  it('passes, from the command line', () => {
    const run = spawnSync(process.execPath, ['scripts/check-layout.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });
});
