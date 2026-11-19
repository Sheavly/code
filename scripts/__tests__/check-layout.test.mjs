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
/** What a published package ships, and what builds it first: every package fixture has it. */
const PUBLISHED = { files: ['dist', 'docs'], scripts: { prepack: 'npm run build' } };

/** The `exports` entry that makes every file of `kind` public, as the layout expects it. */
const exported = (kind) => ({
  [`./*.${kind}`]: { '@sheavly/source': `./src/*.${kind}.ts`, default: `./dist/*.${kind}.js` },
});

/** A workspace that passes every check: `@sheavly/<folder>` with a domain and its config files. */
function wellFormed(folder, manifest = {}) {
  return {
    [`packages/${folder}/package.json`]: json({
      name: `@sheavly/${folder}`,
      sheavly: { domain: 'generic' },
      exports: exported('utils'),
      ...PUBLISHED,
      ...manifest,
    }),
    [`packages/${folder}/eslint.config.js`]: ESLINT,
    [`packages/${folder}/tsconfig.json`]: TSCONFIG,
    [`packages/${folder}/src/${folder}/${folder}.utils.ts`]: 'export const x = 1;\n',
    [`packages/${folder}/README.md`]: `# ${folder}\n\n| Module | What |\n| --- | --- |\n| \`${folder}/\` | it |\n\n## Docs\n\n- [Design](docs/design.md)\n`,
    [`packages/${folder}/docs/design.md`]: '# Design\n',
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
          exports: exported('utils'),
          ...PUBLISHED,
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
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('packages/base: has no source yet. Add its first module'),
      ]),
    );
  });

  it('fails a workspace not named after its folder', () => {
    expect(
      problems({
        'packages/base/package.json': json({
          name: '@sheavly/other',
          sheavly: { domain: 'generic' },
          exports: exported('utils'),
          ...PUBLISHED,
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
        exports: exported('utils'),
        ...PUBLISHED,
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
        'apps/cli/README.md': '# cli\n\n- [Design](docs/design.md)\n',
        'apps/cli/docs/design.md': '# Design\n',
      }),
    ).toEqual([expect.stringContaining('@sheavly/cli as a dev dependency, an app')]);
  });

  it('fails a package that exports file by file, by an unknown kind, or with other targets', () => {
    const exportsOf = (exports) =>
      problems({
        'packages/base/package.json': json({
          name: '@sheavly/base',
          sheavly: { domain: 'generic' },
          ...(exports !== undefined && { exports }),
          ...PUBLISHED,
        }),
      });

    expect(exportsOf({ './base/base.utils': { default: './dist/base/base.utils.js' } })).toEqual([
      expect.stringContaining('exports ./base/base.utils: a package exports by file kind'),
    ]);
    expect(exportsOf({ './*': { '@sheavly/source': './src/*.ts' } })).toEqual([
      expect.stringContaining('a package exports by file kind'),
    ]);
    expect(exportsOf(undefined)).toEqual([
      expect.stringContaining('has no exports, so every file is public'),
    ]);
    expect(exportsOf({ './*.utils': { default: './dist/*.utils.js' } })).toEqual([
      expect.stringContaining('exports ./*.utils with other targets'),
    ]);
    expect(exportsOf({ ...exported('utils'), './testing/*': { default: './dist/x.js' } })).toEqual([
      expect.stringContaining('but not from source only'),
    ]);
    expect(exportsOf({ ...exported('utils'), ...exported('fake') })).toEqual([
      expect.stringContaining('exports its fakes as a kind'),
    ]);
  });

  it('fails a build config that references other workspaces than the ones depended on', () => {
    const build = (refs) =>
      json({ extends: './tsconfig.json', references: refs.map((ref) => ({ path: ref })) });

    expect(
      problems({ 'packages/top/tsconfig.build.json': build(['../base/tsconfig.build.json']) }),
    ).toEqual([]);
    expect(
      problems({ 'packages/top/tsconfig.build.json': build(['../lint/tsconfig.build.json']) }),
    ).toEqual([
      expect.stringContaining('add a reference to packages/base, which @sheavly/top depends on'),
      expect.stringContaining('drop the reference to packages/lint'),
    ]);
    // A workspace with no source yet is skipped: its first import installs what it references.
    expect(
      problems({
        'packages/top/tsconfig.build.json': build(['../lint/tsconfig.build.json']),
        'packages/top/src/top/top.utils.ts': null,
      }),
    ).not.toContainEqual(expect.stringContaining('tsconfig.build.json'));
  });

  it.each([{ appOnlyModules: [] }, { appOnlyModules: ['base'] }])(
    'passes valid app-only module metadata %j',
    ({ appOnlyModules }) => {
      expect(
        problems(wellFormed('base', { sheavly: { domain: 'generic', appOnlyModules } })),
      ).toEqual([]);
    },
  );

  it.each([
    ['a string instead of an array', 'base'],
    ['null instead of an array', null],
    ['an object instead of an array', {}],
    ['a non-string module', [1]],
    ['an empty module name', ['']],
    ['a non-kebab-case module name', ['Base']],
    ['a nested module path', ['base/nested']],
    ['a parent-relative module path', ['../base']],
    ['an unknown module', ['missing']],
    ['a duplicate module', ['base', 'base']],
  ])('fails app-only module metadata with %s', (_, appOnlyModules) => {
    expect(
      problems({
        ...wellFormed('base', { sheavly: { domain: 'generic', appOnlyModules } }),
        'packages/base/src/Base/base.helper.ts': 'export const x = 1;\n',
        'packages/base/src/base/nested/nested.helper.ts': 'export const x = 1;\n',
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('appOnlyModules')]));
  });

  it('allows a generic runtime dependency on a package with app-only tools and backend modules', () => {
    expect(
      problems({
        ...wellFormed('pieces', {
          sheavly: { domain: 'generic', appOnlyModules: ['tools', 'backends'] },
        }),
        'packages/pieces/src/tools/tools.tool.ts': 'export const x = 1;\n',
        'packages/pieces/src/backends/backends.helper.ts': 'export const x = 1;\n',
        ...wellFormed('top', { dependencies: { '@sheavly/pieces': '0' } }),
      }),
    ).toEqual([]);
  });

  it('fails a package that depends on a provider package at runtime; a dev dependency is fine', () => {
    const files = {
      ...wellFormed('models'),
      'packages/models/src/openai/openai.adapter.ts': 'export const x = 1;\n',
    };

    expect(
      problems({ ...files, ...wellFormed('top', { dependencies: { '@sheavly/models': '0' } }) }),
    ).toEqual([
      expect.stringContaining(
        '@sheavly/top depends on @sheavly/models, which holds the model backends',
      ),
    ]);
    expect(
      problems({ ...files, ...wellFormed('top', { devDependencies: { '@sheavly/models': '0' } }) }),
    ).toEqual([]);
  });

  describe('an extension and the host', () => {
    /** A well-formed workspace moved under `extensions/`, with the manifest fields given. */
    const extension = (manifest) => ({
      ...Object.fromEntries(
        Object.entries(
          wellFormed('notes', { files: [...PUBLISHED.files, 'sheavly.json'], ...manifest }),
        ).map(([file, content]) => [file.replace('packages/', 'extensions/'), content]),
      ),
      'extensions/notes/sheavly.json': json({ name: 'notes' }),
    });
    const withHost = (files) =>
      problems({
        'package.json': json({
          name: 'monorepo',
          workspaces: ['packages/*', 'apps/*', 'extensions/*'],
        }),
        ...wellFormed('host'),
        ...files,
      });

    it('fails an extension with the host in dependencies, optionalDependencies or peerDependencies', () => {
      for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        expect(withHost(extension({ [field]: { '@sheavly/host': '0' } }))).toEqual([
          expect.stringContaining(
            `@sheavly/notes lists @sheavly/host under ${field}: an extension takes the contract from @sheavly/extension and may use the host only in its tests. Move @sheavly/host to devDependencies.`,
          ),
        ]);
      }
    });

    it('accepts the host as a dev dependency, and any other run-time dependency', () => {
      expect(withHost(extension({ devDependencies: { '@sheavly/host': '0' } }))).toEqual([]);
      expect(withHost(extension({ dependencies: { '@sheavly/base': '0' } }))).toEqual([]);
    });

    it('leaves an app depending on the host alone', () => {
      expect(
        withHost({
          'apps/cli/package.json': json({
            name: '@sheavly/cli',
            sheavly: { domain: 'coding' },
            dependencies: { '@sheavly/host': '0' },
          }),
          'apps/cli/eslint.config.js': ESLINT,
          'apps/cli/tsconfig.json': TSCONFIG,
          'apps/cli/src/main.ts': 'export {};\n',
          'apps/cli/README.md': '# cli\n\n- [Design](docs/design.md)\n',
          'apps/cli/docs/design.md': '# Design\n',
        }),
      ).toEqual([]);
    });
  });

  it('fails a workspace with no README, no docs/, or a doc its README never links', () => {
    expect(problems({ 'packages/base/README.md': null })).toEqual([
      expect.stringContaining('packages/base/README.md is missing'),
    ]);
    expect(problems({ 'packages/base/docs/design.md': null })).toEqual([
      expect.stringContaining('packages/base/docs/ is missing or empty'),
    ]);
    expect(problems({ 'packages/base/docs/more.md': '# More\n' })).toEqual([
      expect.stringContaining("packages/base/README.md doesn't link docs/more.md"),
    ]);
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
