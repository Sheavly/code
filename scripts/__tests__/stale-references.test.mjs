import { afterEach, describe, expect, it } from 'vitest';
import { staleReferenceProblems } from '../stale-references.mjs';
import { createTempRepo, removeTempRepos } from './temp-repo.utils.mjs';

afterEach(removeTempRepos);

const FILES = {
  'package.json': JSON.stringify({ name: 'monorepo', workspaces: ['packages/*', 'apps/*'] }),
  'packages/loop/package.json': JSON.stringify({ name: '@sheavly/loop' }),
  'packages/loop/src/turn/turn.helper.ts': 'export const turn = 1;\n',
  'packages/loop/src/testing/loop.fake.ts': 'export const fake = 1;\n',
  'packages/core/package.json': JSON.stringify({ name: '@sheavly/core' }),
  'packages/core/src/testing/echo.fake.ts': 'export const echo = 1;\n',
  'apps/workbook/package.json': JSON.stringify({ name: '@sheavly/workbook' }),
  'apps/workbook/src/workbook/workbook.ts': '// Reads src/workbook/workbook.ts.\n',
};

const problems = (files) => {
  const all = { ...FILES, ...files };

  return staleReferenceProblems({ root: createTempRepo(all), files: Object.keys(all) });
};

describe('stale references', () => {
  it("fails a path into the old root src/ that names a workspace's folder", () => {
    expect(problems({ 'docs/notes.md': 'See `src/loop/turn.helper.ts`.\n' })).toEqual([
      expect.stringContaining('docs/notes.md: `src/loop/turn.helper.ts` is the layout before'),
    ]);
  });

  it("passes a workspace's own src/ path, a convention folder and tests' temp paths", () => {
    expect(
      problems({
        'docs/notes.md': 'Fakes go in `src/testing/`; see `packages/loop/src/turn/`.\n',
        'packages/loop/src/turn/__tests__/turn.test.ts': "const file = 'src/loop/x.ts';\n",
      }),
    ).toEqual([]);
  });

  it('fails an issue named in source, and a promise about one anywhere', () => {
    expect(
      problems({
        'packages/loop/src/turn/turn.constants.ts': '// Moves into the coding package (#29).\n',
        'docs/notes.md': 'This stays here until #12 lands.\nSee #13 for compaction.\n',
      }),
    ).toEqual([
      expect.stringContaining('turn.constants.ts:1: names an issue in code'),
      expect.stringContaining('docs/notes.md:1: promises what an issue will do'),
    ]);
  });
});
