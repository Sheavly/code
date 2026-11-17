import { chmodSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSheavlyJson } from '../extension-manifest.utils.js';
import { layoutProblems, readLayout } from '../layout.utils.js';
import { tempWorkspace } from '../testing/workspace.fake.js';

const SHIPPED = ['dist', 'docs', 'sheavly.json'];

/**
 * A monorepo with a package, an extension `files` and an extension `notes` that depends on it.
 * `notes` takes the overrides: its `sheavly.json` (text, JSON, or null for none), its package
 * `files` and its dependencies.
 */
function repo(overrides = {}) {
  const { manifest = { name: 'notes', dependsOn: ['files'] }, files = SHIPPED } = overrides;
  const { dependencies = { '@sheavly/files': '0' }, extra = {} } = overrides;
  const workspace = (dir, fields) => ({
    [`${dir}/package.json`]: {
      name: `@sheavly/${path.basename(dir)}`,
      sheavly: { domain: 'generic' },
      exports: {},
      scripts: { prepack: 'npm run build' },
      files: SHIPPED,
      ...fields,
    },
  });

  return tempWorkspace({
    'package.json': { name: 'monorepo', workspaces: ['packages/*', 'extensions/*', 'apps/*'] },
    ...workspace('packages/base', { files: ['dist', 'docs'] }),
    ...workspace('extensions/files', {}),
    'extensions/files/sheavly.json': { name: 'files' },
    ...workspace('extensions/notes', { files, dependencies }),
    ...(manifest !== null && { 'extensions/notes/sheavly.json': manifest }),
    ...extra,
  });
}

const problemsOf = (root) => layoutProblems(readLayout({ root }));

describe('an extension workspace and its sheavly.json', () => {
  it('passes when the file names the folder, lists the extension dependencies and ships', () => {
    expect(problemsOf(repo())).toEqual([]);
    // The order of dependsOn does not matter, and a package dependency is not an extension.
    const both = repo({
      manifest: { name: 'notes', dependsOn: ['files', 'more'] },
      dependencies: { '@sheavly/more': '0', '@sheavly/files': '0', '@sheavly/base': '0' },
      extra: {
        'extensions/more/package.json': {
          name: '@sheavly/more',
          sheavly: { domain: 'generic' },
          exports: {},
          scripts: { prepack: 'npm run build' },
          files: SHIPPED,
        },
        'extensions/more/sheavly.json': { name: 'more' },
      },
    });

    expect(problemsOf(both)).toEqual([]);
  });

  it('fails an extension with no sheavly.json, saying what to write', () => {
    expect(problemsOf(repo({ manifest: null }))).toEqual([
      '@sheavly/notes has no sheavly.json: every extension declares itself in extensions/notes/sheavly.json, starting with `{ "name": "notes" }`',
    ]);
  });

  it('fails a file that is not strict JSON', () => {
    const [problem, ...rest] = problemsOf(repo({ manifest: '{ "name": "notes", }' }));

    expect(rest).toEqual([]);
    expect(problem).toMatch(
      /^@sheavly\/notes's sheavly\.json is not valid JSON \(.+\): it is strict JSON, no comments or trailing commas$/,
    );
  });

  it('fails a sheavly.json that is a directory, instead of throwing', () => {
    const [problem, ...rest] = problemsOf(
      repo({ manifest: null, extra: { 'extensions/notes/sheavly.json/keep': 'x' } }),
    );

    expect(rest).toEqual([]);
    expect(problem).toBe(
      "@sheavly/notes's sheavly.json cannot be read (EISDIR): it must be a regular file of strict JSON that the check can open",
    );
  });

  // Root reads any file, and Windows has no mode bits: the case cannot be built there.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports a sheavly.json it has no permission to read as { exists: true, error }',
    () => {
      const root = repo();
      const dir = path.join(root, 'extensions/notes');

      chmodSync(path.join(dir, 'sheavly.json'), 0o000);

      expect(readSheavlyJson(dir)).toEqual({ exists: true, error: 'EACCES', unreadable: true });
      expect(problemsOf(root).join('\n')).toContain('cannot be read (EACCES)');
    },
  );

  it('fails a file that is not an object', () => {
    expect(problemsOf(repo({ manifest: '["notes"]' }))).toEqual([
      '@sheavly/notes\'s sheavly.json must be a JSON object: write `{ "name": "notes" }`',
    ]);
  });

  it('fails a name that is not the folder', () => {
    expect(problemsOf(repo({ manifest: { name: 'note', dependsOn: ['files'] } }))).toEqual([
      '@sheavly/notes\'s sheavly.json must have "name": "notes", the folder name (it says \'note\')',
    ]);
    expect(problemsOf(repo({ manifest: { dependsOn: ['files'] } }))).toEqual([
      '@sheavly/notes\'s sheavly.json must have "name": "notes", the folder name',
    ]);
  });

  it('fails a dependsOn that omits an extension the package depends on', () => {
    expect(problemsOf(repo({ manifest: { name: 'notes' } }))).toEqual([
      "@sheavly/notes's sheavly.json \"dependsOn\" must list 'files', an extension in this package's dependencies: add it",
    ]);
  });

  it('fails a dependsOn that lists what the package does not depend on', () => {
    expect(
      problemsOf(repo({ manifest: { name: 'notes', dependsOn: ['files', 'ghost'] } })),
    ).toEqual([
      "@sheavly/notes's sheavly.json \"dependsOn\" lists 'ghost', which is not an extension in this package's dependencies (devDependencies don't count): remove it, or add the dependency",
    ]);
  });

  it.each(['devDependencies', 'peerDependencies', 'optionalDependencies'])(
    'does not count a %s as an extension dependency for dependsOn: only `dependencies` do',
    (field) => {
      const root = repo({
        manifest: { name: 'notes', dependsOn: ['files'] },
        dependencies: {},
        extra: {
          'extensions/notes/package.json': {
            name: '@sheavly/notes',
            sheavly: { domain: 'generic' },
            exports: {},
            scripts: { prepack: 'npm run build' },
            files: SHIPPED,
            [field]: { '@sheavly/files': '0' },
          },
        },
      });

      expect(problemsOf(root).join('\n')).toContain(
        "\"dependsOn\" lists 'files', which is not an extension in this package's dependencies",
      );
    },
  );

  it('fails a dependsOn that is not an array', () => {
    expect(problemsOf(repo({ manifest: { name: 'notes', dependsOn: 'files' } }))).toEqual([
      '@sheavly/notes\'s sheavly.json "dependsOn" must be an array of extension names',
    ]);
  });

  it('fails a package whose files do not ship the sheavly.json', () => {
    expect(problemsOf(repo({ files: ['dist', 'docs'] }))).toEqual([
      '@sheavly/notes doesn\'t ship its sheavly.json: add it to `files`, `npm pkg set \'files=["dist","docs","sheavly.json"]\' --json -w extensions/notes`',
    ]);
  });
});

describe('a sheavly.json outside extensions/', () => {
  it('fails in a package and in an app', () => {
    const misplaced = repo({
      extra: {
        'packages/base/sheavly.json': { name: 'base' },
        'apps/cli/package.json': { name: '@sheavly/cli', sheavly: { domain: 'coding' } },
        'apps/cli/sheavly.json': { name: 'cli' },
      },
    });

    expect(problemsOf(misplaced)).toEqual([
      '@sheavly/base has a sheavly.json, but only an extension (extensions/*) has one: remove packages/base/sheavly.json',
      '@sheavly/cli has a sheavly.json, but only an extension (extensions/*) has one: remove apps/cli/sheavly.json',
    ]);
  });
});
