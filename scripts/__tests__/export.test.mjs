import { afterEach, describe, expect, it } from 'vitest';
import { exportCommand } from '../export.mjs';
import { createTempRepo, removeTempRepos } from './temp-repo.utils.mjs';

afterEach(removeTempRepos);

const repo = () =>
  createTempRepo({
    'package.json': JSON.stringify({ name: 'monorepo', workspaces: ['packages/*', 'apps/*'] }),
    'packages/kit/package.json': JSON.stringify({ name: '@sheavly/kit' }),
    'packages/kit/src/tool/tool.utils.ts': 'export const x = 1;\n',
    'apps/cli/package.json': JSON.stringify({ name: '@sheavly/cli' }),
  });

describe('npm run export', () => {
  it('sets one exports entry through npm, with the source, types and build targets', () => {
    expect(exportCommand({ root: repo(), specifier: '@sheavly/kit/tool/tool.utils' })).toEqual({
      args: [
        'pkg',
        'set',
        'exports[./tool/tool.utils][@sheavly/source]=./src/tool/tool.utils.ts',
        'exports[./tool/tool.utils].types=./dist/tool/tool.utils.d.ts',
        'exports[./tool/tool.utils].default=./dist/tool/tool.utils.js',
        '-w',
        'packages/kit',
      ],
    });
  });

  it('refuses a file that does not exist, and an app', () => {
    const root = repo();

    expect(exportCommand({ root, specifier: '@sheavly/kit/tool/gone.utils' }).problem).toContain(
      "doesn't exist",
    );
    expect(exportCommand({ root, specifier: '@sheavly/cli/main' }).problem).toContain(
      'names no package',
    );
  });
});
