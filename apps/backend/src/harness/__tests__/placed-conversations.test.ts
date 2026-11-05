import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Model } from '@sheavly/protocol/model/model.types';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { collect, fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { useTempFolders } from '@sheavly/testing/files/temp-folders.fake';
import { testBackend } from '../../testing/backend.fake.js';

const WORK = profileIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
const HOME = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71');
const WORK_MODEL = modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a31');
const HOME_MODEL = modelIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b72');
const say = (text: string) => [{ type: 'response.output_text.delta', delta: text }];

const folders = useTempFolders({ prefix: 'placed-conversations-', names: ['app', 'site'] });
const sheavly = () => path.join(folders.base, 'sheavly');

/** A backend whose own folder is `app`, on a model that answers `reply`. */
function backend(reply = 'hello') {
  const { fetch } = fakeFetchSequence({ responses: [say(reply)] });

  return testBackend({ home: sheavly(), workspace: folders.app, fetch });
}

const model = (id: typeof WORK_MODEL, name: string): Model => ({
  id,
  name,
  adapter: 'openai',
  definition: { model: `gpt-${name.toLowerCase()}` },
});

/** Two profiles, each with its own model and key, through the setup the way a UI does. */
async function twoProfiles(made: ReturnType<typeof backend>) {
  for (const [id, name, modelId, label] of [
    [WORK, 'Work', WORK_MODEL, 'Astra'],
    [HOME, 'Home', HOME_MODEL, 'Bora'],
  ] as const) {
    await made.setup.putProfile({ id, name });
    await made.setup.putModel({ profile: id, id: modelId, model: model(modelId, label) });
    await made.setup.putCredential({
      profile: id,
      model: modelId,
      secrets: { apiKey: `key-${name}` },
    });
  }

  await made.setup.setDefaultProfile(WORK);
}

const talk = async (
  made: ReturnType<typeof backend>,
  id: Parameters<ReturnType<typeof backend>['conversations']['send']>[0]['id'],
) => collect((await made.conversations.send({ id, prompt: { text: 'hi' } })).events);

/**
 * Two profiles, then one conversation in the backend's own folder (on the default profile) and one
 * in the site on Home, each spoken to once and the backend closed. Returns their ids.
 */
async function keepOneInEach(made: ReturnType<typeof backend>) {
  await twoProfiles(made);

  const inApp = await made.conversations.start();
  const inSite = await made.conversations.start({ workspace: folders.site, profile: HOME });

  await talk(made, inApp);
  await talk(made, inSite);
  await made.conversations.closeAll();

  return { inApp, inSite };
}

describe('conversations placed by their start', () => {
  it('runs in the backend’s own folder on the default profile when the start names neither', async () => {
    const made = backend();

    await twoProfiles(made);

    const id = await made.conversations.start();

    expect(made.conversations.details(id)).toMatchObject({ profile: WORK });
    expect(made.conversations.details(id).workspace).toContain('app');
    await made.conversations.closeAll();
  });

  it('runs in the folder it names, and on the profile it names, whatever the backend’s own is', async () => {
    const made = backend();

    await twoProfiles(made);

    const id = await made.conversations.start({ workspace: folders.site, profile: HOME });

    expect(made.conversations.details(id)).toMatchObject({
      profile: HOME,
      workspace: expect.stringContaining('site') as string,
      model: { id: HOME_MODEL },
    });
    await made.conversations.closeAll();
  });

  it('keeps several running at once, each on its own folder and profile', async () => {
    const made = backend();

    await twoProfiles(made);

    const [a, b, c] = [
      await made.conversations.start(),
      await made.conversations.start({ workspace: folders.site, profile: HOME }),
      await made.conversations.start({ workspace: folders.site }),
    ] as const;

    expect(made.conversations.details(a)).toMatchObject({
      profile: WORK,
      model: { id: WORK_MODEL },
    });
    expect(made.conversations.details(b)).toMatchObject({
      profile: HOME,
      model: { id: HOME_MODEL },
    });
    // Two in one folder: the second takes the default profile, the first's folder-mate runs on Home.
    expect(made.conversations.details(c).workspace).toBe(made.conversations.details(b).workspace);
    expect(made.conversations.details(c).profile).toBe(WORK);
    await made.conversations.closeAll();
  });

  it('refuses a profile that does not exist and a folder that cannot be used, starting nothing', async () => {
    const made = backend();

    await twoProfiles(made);

    const ghost = profileIdSchema.parse('c1e8a3d4-7b25-4e69-8f10-2a6d9b4c7e53');

    await expect(made.conversations.start({ profile: ghost })).rejects.toMatchObject({
      name: 'SetupError',
      reason: 'invalid',
    });

    for (const workspace of [
      path.join(folders.base, 'missing'),
      'relative/path',
      path.resolve(path.sep),
      sheavly(),
    ]) {
      await expect(made.conversations.start({ workspace }), workspace).rejects.toMatchObject({
        reason: 'invalid',
      });
    }

    expect(made.conversations.list()).toEqual([]);
  });

  it('is not started in a file where a folder is expected', async () => {
    const made = backend();

    await twoProfiles(made);
    await writeFile(path.join(folders.base, 'file.txt'), 'x');

    await expect(
      made.conversations.start({ workspace: path.join(folders.base, 'file.txt') }),
    ).rejects.toMatchObject({
      reason: 'invalid',
      message: expect.stringContaining('not a folder') as string,
    });
  });

  it('shares the file locks and nothing else of a harness between conversations of one backend', async () => {
    const made = backend();

    await twoProfiles(made);

    const first = made.conversations.get(await made.conversations.start());
    const second = made.conversations.get(
      await made.conversations.start({ workspace: folders.site }),
    );

    // Two folders, two profiles' worth of state: one lock set, so a file is edited by one at a time.
    expect((first.harness as { fileLocks?: unknown }).fileLocks).toBe(
      (second.harness as { fileLocks?: unknown }).fileLocks,
    );
    expect(first.harness).not.toBe(second.harness);
    expect(first.harness.sessions).not.toBe(second.harness.sessions);
    await made.conversations.closeAll();
  });
});

describe('where each conversation is kept, and found again', () => {
  const folderOf = async (profile: string) =>
    (await readdir(path.join(sheavly(), 'profiles', profile, 'workspaces'))).length;

  it('files each under its own profile and folder, so nothing of one lands in another', async () => {
    const made = backend();

    await keepOneInEach(made);

    // One folder under each profile: Work holds the app's, Home the site's.
    expect(await folderOf(WORK)).toBe(1);
    expect(await folderOf(HOME)).toBe(1);
  });

  it('files two conversations of one profile in different folders by the folders they work in', async () => {
    const made = backend();

    await twoProfiles(made);

    const inApp = await made.conversations.start({ workspace: folders.app });
    const inSite = await made.conversations.start({ workspace: folders.site });

    await talk(made, inApp);
    await talk(made, inSite);
    await made.conversations.closeAll();

    // Both ran on Work, in different folders: two folders, each holding exactly its own.
    expect(await folderOf(WORK)).toBe(2);

    const restarted = backend();
    const listed = await restarted.conversations.listStored();

    expect(listed.find((each) => each.id === inApp)?.workspace).toContain('app');
    expect(listed.find((each) => each.id === inSite)?.workspace).toContain('site');
    expect(
      (await restarted.conversations.listStored({ workspace: listed[0]?.workspace })).map(
        (e) => e.id,
      ),
    ).toHaveLength(1);
  });

  it('lists the conversations of every folder and profile, tagged, and filters by either', async () => {
    const made = backend();
    const { inApp, inSite } = await keepOneInEach(made);

    const restarted = backend();
    const all = await restarted.conversations.listStored();

    expect(all.map((each) => each.id).sort()).toEqual([inApp, inSite].sort());
    expect(all.find((each) => each.id === inSite)).toMatchObject({ profile: HOME });
    expect((await restarted.conversations.listStored({ profile: HOME })).map((e) => e.id)).toEqual([
      inSite,
    ]);
    expect(
      (
        await restarted.conversations.listStored({
          workspace: all.find((e) => e.id === inApp)?.workspace,
        })
      ).map((e) => e.id),
    ).toEqual([inApp]);
  });

  it('reopens a conversation in the folder and on the profile it started on, after a restart', async () => {
    const made = backend();

    await twoProfiles(made);

    const id = await made.conversations.start({ workspace: folders.site, profile: HOME });

    await talk(made, id);
    await made.conversations.closeAll();

    // The restarted backend's own folder is `app` and its default is Work: neither is where this lives.
    const restarted = backend('welcome back');

    await restarted.conversations.reopen(id);

    expect(restarted.conversations.details(id)).toMatchObject({
      profile: HOME,
      workspace: expect.stringContaining('site') as string,
      model: { id: HOME_MODEL },
    });
    await restarted.conversations.closeAll();
  });

  it('refuses to reopen into a folder that has been deleted, and keeps the conversation', async () => {
    const made = backend();

    await twoProfiles(made);

    const id = await made.conversations.start({ workspace: folders.site });

    await talk(made, id);
    await made.conversations.closeAll();
    await rm(folders.site, { recursive: true });

    const restarted = backend();

    await expect(restarted.conversations.reopen(id)).rejects.toMatchObject({ reason: 'invalid' });
    expect((await restarted.conversations.listStored()).map((each) => each.id)).toEqual([id]);
  });
});
