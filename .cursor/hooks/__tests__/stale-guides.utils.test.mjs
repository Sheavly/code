import { afterEach, describe, expect, it } from 'vitest';
import { staleGuides } from '../docs.utils.mjs';
import { createTempRepo, removeTempRepos } from '../../../scripts/__tests__/temp-repo.utils.mjs';

afterEach(removeTempRepos);

const DIR = '.agents/skills/zz';
const repo = (metadata) =>
  createTempRepo({
    [`${DIR}/SKILL.md`]: '# Router\n',
    [`${DIR}/loop.md`]: '# Loop\n',
    [`${DIR}/layers.md`]: '# Layers\n',
    [`${DIR}/harness.json`]: JSON.stringify({
      governs: ['packages/**'],
      guides: { 'loop.md': ['packages/loop/**'], 'layers.md': ['packages/**'] },
      nudge: ['loop.md'],
      ...metadata,
    }),
  });

describe('staleGuides', () => {
  it('names a nudged guide when a file it covers changed and the guide did not', () => {
    expect(staleGuides(['packages/loop/src/turn/turn.helper.ts'], repo())).toEqual([
      { doc: `${DIR}/loop.md`, files: ['packages/loop/src/turn/turn.helper.ts'] },
    ]);
  });

  it('stays quiet once the guide changed too', () => {
    expect(
      staleGuides(['packages/loop/src/turn/turn.helper.ts', `${DIR}/loop.md`], repo()),
    ).toEqual([]);
  });

  it('does not nudge a guide the skill left out of `nudge`, however broad', () => {
    expect(staleGuides(['packages/core/src/x/x.helper.ts'], repo())).toEqual([]);
  });

  it('ignores tests, fakes and files the guide does not cover', () => {
    expect(
      staleGuides(
        [
          'packages/loop/src/turn/__tests__/turn.test.ts',
          'packages/loop/src/testing/x.fake.ts',
          'packages/core/src/x/x.helper.ts',
        ],
        repo(),
      ),
    ).toEqual([]);
  });

  it('counts the source of a workspace whose folder is called testing', () => {
    const root = repo({ guides: { 'loop.md': ['packages/testing/**'] } });
    const file = 'packages/testing/src/provider/routed-provider.fake.ts';

    expect(staleGuides([file], root)).toEqual([{ doc: `${DIR}/loop.md`, files: [file] }]);
  });

  it('picks up a new skill that lists its own nudge, with no list to edit', () => {
    const root = createTempRepo({
      '.agents/skills/other/SKILL.md': '# Other\n',
      '.agents/skills/other/a.md': '# A\n',
      '.agents/skills/other/harness.json': JSON.stringify({
        governs: ['docs/**'],
        guides: { 'a.md': ['docs/a/**'] },
        nudge: ['a.md'],
      }),
    });

    expect(staleGuides(['docs/a/x.md'], root)).toEqual([
      { doc: '.agents/skills/other/a.md', files: ['docs/a/x.md'] },
    ]);
  });
});
