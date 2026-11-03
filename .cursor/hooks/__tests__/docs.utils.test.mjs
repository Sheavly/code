import { afterEach, describe, expect, it } from 'vitest';
import { staleDocs } from '../docs.utils.mjs';
import { createTempRepo, removeTempRepos } from '../../../scripts/__tests__/temp-repo.utils.mjs';

afterEach(removeTempRepos);

const repo = () =>
  createTempRepo({
    'package.json': JSON.stringify({ name: 'monorepo', workspaces: ['packages/*', 'apps/*'] }),
    'packages/core/package.json': JSON.stringify({ name: '@sheavly/core' }),
    'packages/loop/package.json': JSON.stringify({ name: '@sheavly/loop' }),
    'apps/cli/package.json': JSON.stringify({ name: '@sheavly/cli' }),
  });

describe('staleDocs', () => {
  it('names each workspace whose source changed but not its README or docs/', () => {
    expect(
      staleDocs(
        ['packages/core/src/tool/tool.utils.ts', 'apps/cli/src/main.ts', 'scripts/x.mjs'],
        repo(),
      ),
    ).toEqual([
      { doc: 'packages/core/README.md', files: ['packages/core/src/tool/tool.utils.ts'] },
      { doc: 'apps/cli/README.md', files: ['apps/cli/src/main.ts'] },
    ]);
  });

  it('counts a change to the README or anything in docs/ for the whole workspace', () => {
    const root = repo();

    expect(
      staleDocs(['packages/core/src/tool/tool.utils.ts', 'packages/core/docs/tools.md'], root),
    ).toEqual([]);
    expect(staleDocs(['packages/loop/src/x/x.helper.ts', 'packages/loop/README.md'], root)).toEqual(
      [],
    );
  });

  it('skips tests and fakes, and a workspace another one changed the docs of', () => {
    const root = repo();

    expect(
      staleDocs(
        [
          'packages/core/src/tool/__tests__/tool.utils.test.ts',
          'packages/core/src/testing/echo.fake.ts',
        ],
        root,
      ),
    ).toEqual([]);
    expect(
      staleDocs(['packages/loop/src/x/x.helper.ts', 'packages/core/docs/tools.md'], root),
    ).toEqual([{ doc: 'packages/loop/README.md', files: ['packages/loop/src/x/x.helper.ts'] }]);
  });

  it('counts the source of a workspace whose folder is called testing', () => {
    const root = createTempRepo({
      'package.json': JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] }),
      'packages/testing/package.json': JSON.stringify({ name: '@sheavly/testing' }),
    });
    const file = 'packages/testing/src/provider/routed-provider.fake.ts';

    expect(staleDocs([file], root)).toEqual([{ doc: 'packages/testing/README.md', files: [file] }]);
  });
});
