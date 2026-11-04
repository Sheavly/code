import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { entry, indexOf, CONVERSATION } from '@sheavly/testing/store/store-contract.fake';
import { workspaceKey } from '../../config-store/config-store.utils.js';
import { RegistryError } from '../../errors/registry.errors.js';
import type { FileProblem } from '../../listing/listing.types.js';
import { WORK, useTempRegistry } from '../../testing/registry.fake.js';

const temp = useTempRegistry();
const APP = path.resolve(path.sep, 'code', 'app');
const SITE = path.resolve(path.sep, 'code', 'site');

/** A profile that exists, opened, and the problems its conversation stores report. */
async function openWork() {
  await temp.registry().put({ id: WORK, name: 'Work' });

  return temp.registry().open(WORK);
}

const conversationsOf = (params: {
  realPath: string;
  profile: Awaited<ReturnType<typeof openWork>>;
}) =>
  params.profile.conversations({ realPath: params.realPath, onProblem: (_p: FileProblem) => 0 });

describe('OpenProfile.conversations', () => {
  it('keeps a workspace’s conversations under the profile, in a folder named by the path’s key', async () => {
    const profile = await openWork();
    const store = await conversationsOf({ realPath: APP, profile });

    await store.writeIndex(indexOf(CONVERSATION, 1));

    const folder = path.join(
      temp.root(),
      'profiles',
      WORK,
      'workspaces',
      workspaceKey({ realPath: APP }),
    );

    expect((await readdir(path.join(folder, 'conversations'))).sort()).toEqual([CONVERSATION]);
  });

  it('writes workspace.json beside it, so a person can tell which path the folder is', async () => {
    const profile = await openWork();

    await conversationsOf({ realPath: APP, profile });

    const file = path.join(
      temp.root(),
      'profiles',
      WORK,
      'workspaces',
      workspaceKey({ realPath: APP }),
      'workspace.json',
    );

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ root: APP });
  });

  it('is the same store every time for one workspace, so its streams share their queues', async () => {
    const profile = await openWork();

    expect(await conversationsOf({ realPath: APP, profile })).toBe(
      await conversationsOf({ realPath: APP, profile }),
    );
  });

  it('keeps two workspaces’ conversations apart', async () => {
    const profile = await openWork();
    const app = await conversationsOf({ realPath: APP, profile });
    const site = await conversationsOf({ realPath: SITE, profile });

    await app.entries(CONVERSATION).append(entry(0));
    await app.writeIndex(indexOf(CONVERSATION, 1));

    expect(await app.list()).toHaveLength(1);
    expect(await site.list()).toEqual([]);
  });

  it('refuses a profile that was deleted, and makes no folder for it', async () => {
    const profile = await openWork();

    await temp.registry().delete(WORK);

    await expect(conversationsOf({ realPath: APP, profile })).rejects.toBeInstanceOf(RegistryError);
    await expect(readdir(path.join(temp.root(), 'profiles', WORK))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
