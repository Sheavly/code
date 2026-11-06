import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexOf, CONVERSATION } from '@sheavly/testing/store/store-contract.fake';
import { workspaceKey } from '../../config-store/config-store.utils.js';
import type { FileProblem } from '../../listing/listing.types.js';
import { APP, SITE, WORK, useTempRegistry } from '../../testing/registry.fake.js';
import { ProfileRegistry } from '../profile-registry.service.js';

const temp = useTempRegistry();

/** Lists the workspaces and returns them with every problem told. */
async function listWorkspaces(profile: Awaited<ReturnType<typeof temp.openWork>>) {
  const problems: FileProblem[] = [];
  const found = await profile.workspaces({ onProblem: (problem) => problems.push(problem) });

  return { found, problems };
}

describe('OpenProfile.workspaces', () => {
  it('lists none for a profile that has kept nothing', async () => {
    const { found, problems } = await listWorkspaces(await temp.openWork());

    expect(found).toEqual([]);
    expect(problems).toEqual([]);
  });

  it('lists every workspace that has conversations, by its real path', async () => {
    const profile = await temp.openWork();
    const app = await profile.conversations({ realPath: APP, onProblem: () => 0 });
    const site = await profile.conversations({ realPath: SITE, onProblem: () => 0 });

    await app.writeIndex(indexOf(CONVERSATION, 1));
    await site.writeIndex(indexOf(CONVERSATION, 2));

    const { found } = await listWorkspaces(profile);

    expect(found.map((workspace) => workspace.root).sort()).toEqual([APP, SITE]);
  });

  it('gives the same store `conversations` gives, so one queue serves both', async () => {
    const profile = await temp.openWork();
    const store = await profile.conversations({ realPath: APP, onProblem: () => 0 });
    const { found } = await listWorkspaces(profile);

    expect(found[0]?.store).toBe(store);
  });

  it('finds a workspace from an earlier run, which this process has not opened', async () => {
    const earlier = await temp.openWork();
    const store = await earlier.conversations({ realPath: APP, onProblem: () => 0 });

    await store.writeIndex(indexOf(CONVERSATION, 1));

    // A new registry on the same folder, as after a restart.
    const restarted = new ProfileRegistry({ root: temp.root() });
    const { found } = await listWorkspaces(await restarted.open(WORK));

    expect(found.map((workspace) => workspace.root)).toEqual([APP]);
    expect((await found[0]?.store.list())?.map((each) => each.id)).toEqual([CONVERSATION]);
  });

  describe('a folder that is not a workspace', () => {
    const workspaces = () => path.join(temp.root(), 'profiles', WORK, 'workspaces');

    it('is told as a problem, and the others are still listed', async () => {
      const profile = await temp.openWork();
      const app = await profile.conversations({ realPath: APP, onProblem: () => 0 });

      await app.writeIndex(indexOf(CONVERSATION, 1));
      await mkdir(path.join(workspaces(), 'not-a-key'), { recursive: true });

      const { found, problems } = await listWorkspaces(profile);

      expect(found.map((workspace) => workspace.root)).toEqual([APP]);
      expect(problems).toHaveLength(1);
      expect(problems[0]?.message).toContain('not a workspace key');
    });

    it.each([
      ['has no workspace.json', undefined, 'workspace.json'],
      ['names a path of another key', JSON.stringify({ root: APP }), 'not this folder'],
      ['is damaged', '{ not json', 'workspace.json'],
    ])(
      'whose workspace.json %s is told, never taken for empty or trusted',
      async (_what, content, says) => {
        const profile = await temp.openWork();
        const key = workspaceKey({ realPath: SITE });

        await mkdir(path.join(workspaces(), key), { recursive: true });

        if (content !== undefined) {
          await writeFile(path.join(workspaces(), key, 'workspace.json'), content);
        }

        const { found, problems } = await listWorkspaces(profile);

        expect(found).toEqual([]);
        expect(problems).toHaveLength(1);
        expect(problems[0]?.file).toContain(key);
        expect(problems[0]?.message).toContain(says);
      },
    );
  });
});
