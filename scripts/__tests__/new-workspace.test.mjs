import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findLayoutProblems } from '../check-layout.mjs';
import { createWorkspace, installCommands, planWorkspace } from '../new-workspace.mjs';
import { createTempRepo, removeTempRepos } from './temp-repo.utils.mjs';

afterEach(removeTempRepos);

const json = (value) => JSON.stringify(value);
const ESLINT =
  "import { baseConfig } from '@sheavly/eslint-config';\n\nexport default baseConfig({ tsconfigRootDir: import.meta.dirname });\n";
const TSCONFIG = json({ extends: '../../tsconfig.base.json', compilerOptions: { rootDir: 'src' } });

/** A repo with a root app and two packages, `core` (generic) and `coding` (coding). */
function repo() {
  const pkg = (folder, domain) => ({
    [`packages/${folder}/package.json`]: json({
      name: `@sheavly/${folder}`,
      version: '0.0.0',
      sheavly: { domain },
    }),
    [`packages/${folder}/eslint.config.js`]: ESLINT,
    [`packages/${folder}/tsconfig.json`]: TSCONFIG,
  });

  // npm runs in it for real, so it gets no link to this repo's node_modules.
  return createTempRepo(
    {
      'package.json': json({
        name: '@sheavly/harness',
        version: '1.0.0',
        private: true,
        workspaces: ['packages/*'],
        sheavly: { domain: 'coding' },
      }),
      'eslint.config.js': ESLINT,
      'tsconfig.json': json({
        extends: './tsconfig.base.json',
        compilerOptions: { rootDir: 'src' },
      }),
      '.prettierrc.json': json({ singleQuote: true, printWidth: 100 }),
      'src/main.ts': 'export {};\n',
      ...pkg('core', 'generic'),
      ...pkg('coding', 'coding'),
    },
    { linkNodeModules: false },
  );
}

const plan = (root, fields) =>
  planWorkspace({ root, domain: 'generic', description: 'What it is for', ...fields });

describe('planning a workspace', () => {
  it('refuses a dependency the graph does not allow, before anything changes', () => {
    const root = repo();

    expect(plan(root, { kind: 'package', name: 'kit', dependsOn: ['coding'] }).problems).toEqual([
      '@sheavly/kit is generic but depends on @sheavly/coding, a coding workspace',
    ]);
    expect(plan(root, { kind: 'package', name: 'kit', dependsOn: ['harness'] }).problems).toEqual([
      '@sheavly/kit depends on @sheavly/harness, an app: nothing imports an app',
    ]);
    expect(plan(root, { kind: 'package', name: 'kit', dependsOn: ['gone'] }).problems).toEqual([
      "@sheavly/kit depends on @sheavly/gone, which isn't a workspace",
    ]);
    expect(plan(root, { kind: 'package', name: 'kit', dependsOn: ['kit'] }).problems).toEqual([
      "@sheavly/kit depends on @sheavly/kit, which isn't a workspace",
    ]);
  });

  it('refuses a bad kind, name, domain or description, and a workspace that exists', () => {
    const root = repo();

    expect(
      plan(root, { kind: 'lib', name: 'Kit', domain: 'misc', description: ' ' }).problems,
    ).toEqual([
      'the kind is `package` or `app`, not `lib`',
      'the name is kebab-case (`road-segments`), not `Kit`',
      '--domain is one of generic, coding, tooling',
      '--description says what the workspace is for, in one line',
    ]);
    expect(plan(root, { kind: 'package', name: 'core' }).problems).toEqual([
      'packages/core (@sheavly/core) already exists',
    ]);
  });

  it('allows a dependency down the graph, and says how to install it with its first import', () => {
    const planned = plan(repo(), { kind: 'package', name: 'kit', dependsOn: ['core'] });

    expect(planned.problems).toEqual([]);
    expect(installCommands(planned)).toEqual(['npm install @sheavly/core@0.0.0 -w packages/kit']);
  });
});

describe('creating a workspace', () => {
  it.each([
    ['package', 'kit', 'generic', ['core']],
    ['app', 'cli', 'coding', ['coding']],
  ])('creates a %s the layout check accepts as it is', async (kind, name, domain, dependsOn) => {
    const root = repo();
    const planned = plan(root, { kind, name, domain, dependsOn });
    const dir = `${kind === 'app' ? 'apps' : 'packages'}/${name}`;

    await createWorkspace({ root, plan: planned });

    const manifest = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
    const files = [
      'package.json',
      'eslint.config.js',
      'tsconfig.json',
      'src/main.ts',
      ...[
        'package.json',
        'eslint.config.js',
        'tsconfig.json',
        'tsconfig.build.json',
        'README.md',
      ].map((file) => `${dir}/${file}`),
      `${dir}/src/${name}/__tests__/manifest.test.ts`,
    ];

    expect(manifest).toMatchObject({
      name: `@sheavly/${name}`,
      private: true,
      sheavly: { domain },
    });
    expect(manifest.dependencies).toBeUndefined(); // installed with its first import
    // The lockfile and the node_modules link know it by its new name, not npm init's folder name.
    const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

    expect(lock.packages[dir].name).toBe(`@sheavly/${name}`);
    expect(lock.packages[`node_modules/@sheavly/${name}`]).toMatchObject({
      resolved: dir,
      link: true,
    });
    expect(lock.packages[`node_modules/${name}`]).toBeUndefined();
    expect(findLayoutProblems({ root, files, splitApp: { dir: '.', layers: {} } })).toEqual([]);
  });

  it('adds apps/* to the root workspaces the first time, through npm', async () => {
    const root = repo();

    await createWorkspace({
      root,
      plan: plan(root, { kind: 'app', name: 'cli', domain: 'coding' }),
    });

    expect(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).workspaces).toEqual([
      'packages/*',
      'apps/*',
    ]);
  });

  it('writes package.json only through npm', async () => {
    const root = repo();
    const calls = [];

    await createWorkspace({
      root,
      plan: plan(root, { kind: 'package', name: 'kit' }),
      npm: (args) => calls.push(args),
    });

    expect(calls.map((args) => args.slice(0, 2).join(' '))).toEqual([
      'init -y',
      'pkg delete',
      'pkg set',
      'pkg set',
      'install --no-audit',
    ]);
  });
});
