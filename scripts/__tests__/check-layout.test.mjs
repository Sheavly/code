import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { findLayoutProblems } from '../check-layout.mjs';
import { createTempRepo, REPO_ROOT, removeTempRepos } from './temp-repo.utils.mjs';

afterEach(removeTempRepos);

const TSCONFIG =
  '{\n  // comments are allowed\n  "extends": "../../tsconfig.base.json",\n  "compilerOptions": { "rootDir": "src" }\n}\n';
const ESLINT =
  "import { baseConfig } from '@sheavly/eslint-config';\n\nexport default baseConfig({ tsconfigRootDir: import.meta.dirname });\n";
const json = (value) => JSON.stringify(value);

/** The `exports` entry for one module, as the layout check expects it. */
const exported = (file) => ({
  [`./${file}`]: {
    '@sheavly/source': `./src/${file}.ts`,
    types: `./dist/${file}.d.ts`,
    default: `./dist/${file}.js`,
  },
});

/** A workspace that passes every check: `@sheavly/<folder>` with a domain and its config files. */
function wellFormed(folder, manifest = {}) {
  return {
    [`packages/${folder}/package.json`]: json({
      name: `@sheavly/${folder}`,
      sheavly: { domain: 'generic' },
      exports: exported(`${folder}/${folder}.utils`),
      ...manifest,
    }),
    [`packages/${folder}/eslint.config.js`]: ESLINT,
    [`packages/${folder}/tsconfig.json`]: TSCONFIG,
    [`packages/${folder}/src/${folder}/${folder}.utils.ts`]: 'export const x = 1;\n',
  };
}

function repo(overrides = {}) {
  const files = {
    'package.json': json({ name: 'monorepo', workspaces: ['packages/*', 'apps/*'] }),
    'eslint.config.js': ESLINT,
    ...wellFormed('base'),
    ...wellFormed('lint', { sheavly: { domain: 'tooling' } }),
    ...wellFormed('top', {
      dependencies: { '@sheavly/base': '0' },
      devDependencies: { '@sheavly/lint': '0' },
    }),
    ...overrides,
  };
  const present = Object.entries(files).filter(([, content]) => content !== null);

  return {
    root: createTempRepo(Object.fromEntries(present)),
    files: present.map(([file]) => file),
  };
}

const problems = (overrides, notSource = {}) =>
  findLayoutProblems({ ...repo(overrides), notSource });

describe('the layout check', () => {
  it('passes workspaces that hold together', () => {
    expect(problems()).toEqual([]);
  });

  it('covers a workspace added by hand, with no edit anywhere else: here, one without a domain', () => {
    expect(
      problems({
        ...wellFormed('stray'),
        'packages/stray/package.json': json({
          name: '@sheavly/stray',
          exports: exported('stray/stray.utils'),
        }),
      }),
    ).toEqual([
      expect.stringContaining('@sheavly/stray has no domain: run `npm pkg set sheavly.domain='),
    ]);
  });

  it('fails a workspace with no source of its own, and says what to add', () => {
    expect(
      problems({
        'packages/base/src/base/base.utils.ts': null,
        'packages/base/package.json': json({
          name: '@sheavly/base',
          sheavly: { domain: 'generic' },
          exports: {},
        }),
      }),
    ).toEqual([expect.stringContaining('packages/base: has no source yet. Add its first module')]);
  });

  it('fails a workspace not named after its folder', () => {
    expect(
      problems({
        'packages/base/package.json': json({
          name: '@sheavly/other',
          sheavly: { domain: 'generic' },
          exports: exported('base/base.utils'),
        }),
      }),
    ).toEqual([expect.stringContaining('@sheavly/other must be named @sheavly/base')]);
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
  ])('fails a workspace with %s', (_, overrides, message) => {
    expect(problems(overrides)).toEqual([expect.stringContaining(message)]);
  });

  it('fails dependencies off the graph, read from package.json', () => {
    const top = (manifest) => ({
      'packages/top/package.json': json({
        name: '@sheavly/top',
        sheavly: { domain: 'generic' },
        exports: exported('top/top.utils'),
        ...manifest,
      }),
    });

    expect(problems(top({ dependencies: { '@sheavly/base': '0', '@sheavly/lint': '0' } }))).toEqual(
      [
        expect.stringContaining(
          '@sheavly/top depends on @sheavly/lint, which source never imports',
        ),
      ],
    );
    expect(
      problems({
        ...top({
          dependencies: { '@sheavly/base': '0' },
          devDependencies: { '@sheavly/cli': '0' },
        }),
        'apps/cli/package.json': json({ name: '@sheavly/cli', sheavly: { domain: 'coding' } }),
        'apps/cli/eslint.config.js': ESLINT,
        'apps/cli/tsconfig.json': TSCONFIG,
        'apps/cli/src/main.ts': 'export {};\n',
      }),
    ).toEqual([expect.stringContaining('@sheavly/cli as a dev dependency, an app')]);
  });

  it('fails a package whose exports is a wildcard, missing, misshapen or names no file', () => {
    const base = (exports) => wellFormed('base', exports === undefined ? {} : { exports });
    const with_ = (exports) => {
      const files = base(exports);

      if (exports === undefined) {
        files['packages/base/package.json'] = json({
          name: '@sheavly/base',
          sheavly: { domain: 'generic' },
        });
      }

      return problems(files);
    };

    expect(
      with_({
        './*': { '@sheavly/source': './src/*.ts', types: './dist/*.d.ts', default: './dist/*.js' },
      }),
    ).toEqual([expect.stringContaining('./*, a wildcard: every file would be public')]);
    expect(with_(undefined)).toEqual([
      expect.stringContaining('has no exports, so every file is public'),
    ]);
    expect(with_({ './base/base.utils': { default: './dist/base/base.utils.js' } })).toEqual([
      expect.stringContaining('./base/base.utils must be'),
    ]);
    expect(with_(exported('base/gone.utils'))).toEqual([
      expect.stringContaining("./src/base/gone.utils.ts doesn't exist"),
    ]);
    expect(
      with_({ ...exported('base/base.utils'), './testing/*': { default: './dist/x.js' } }),
    ).toEqual([expect.stringContaining('./testing/* must point at its source only')]);
  });

  it("fails source outside every workspace's src/, unless NOT_SOURCE says why", () => {
    const stray = { 'tools/gen.ts': 'export {};\n', 'fixtures/app/.hidden/x.cts': 'export {};\n' };

    expect(problems(stray)).toEqual([
      expect.stringContaining('tools/gen.ts: source lives in a workspace'),
      expect.stringContaining('fixtures/app/.hidden/x.cts: source lives in a workspace'),
    ]);
    expect(problems(stray, { 'tools/*.ts': 'generated', 'fixtures/**': 'a fixture' })).toEqual([]);
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
