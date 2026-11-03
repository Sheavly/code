import { afterEach, describe, expect, it } from 'vitest';
import { exportCommand } from '../export.mjs';
import { createTempRepo, removeTempRepos } from './temp-repo.utils.mjs';

afterEach(removeTempRepos);

const repo = () =>
  createTempRepo({
    'package.json': JSON.stringify({ name: 'monorepo', workspaces: ['packages/*', 'apps/*'] }),
    'packages/kit/package.json': JSON.stringify({ name: '@sheavly/kit' }),
    'apps/cli/package.json': JSON.stringify({ name: '@sheavly/cli' }),
  });

describe('npm run export', () => {
  it('exports a whole file kind through npm, from source and from the build', () => {
    expect(exportCommand({ root: repo(), dir: 'packages/kit', kind: 'utils' })).toEqual({
      args: [
        'pkg',
        'set',
        'exports[./*.utils][@sheavly/source]=./src/*.utils.ts',
        'exports[./*.utils][default]=./dist/*.utils.js',
        '-w',
        'packages/kit',
      ],
    });
  });

  it('refuses an app, an unknown kind, and tests or fakes', () => {
    const root = repo();
    const problem = (dir, kind) => exportCommand({ root, dir, kind }).problem;

    expect(problem('apps/cli', 'utils')).toContain('is no package');
    expect(problem('packages/kit', 'stuff')).toContain('is no kind a package exports');
    expect(problem('packages/kit', 'test')).toContain('is no kind a package exports');
    expect(problem('packages/kit', 'fake')).toContain('fakes are exported as ./testing/*');
  });
});
