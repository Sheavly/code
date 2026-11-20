import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { ProfileStore } from '../../profile-store/profile-store.service.js';
import { SettingsFiles } from '../settings-files.service.js';

const WORK = profileIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
let root: string;
let profiles: ProfileStore;
let files: SettingsFiles;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'storage-settings-profile-'));
  profiles = new ProfileStore({ root });
  files = new SettingsFiles({ root });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('a profile folder with a settings file', () => {
  it('is still listed as a profile, with no problem', async () => {
    await profiles.put({ id: WORK, name: 'Work' });
    await writeFile(path.join(profiles.folderOf(WORK), 'settings.json'), '{ "settings": {} }');

    expect(await profiles.list()).toEqual({ profiles: [{ id: WORK, name: 'Work' }], problems: [] });
    expect(await profiles.get(WORK)).toEqual({ id: WORK, name: 'Work' });
  });

  it('is not a profile without its profile.json, because of a settings file alone', async () => {
    await mkdir(profiles.folderOf(WORK), { recursive: true });
    await writeFile(path.join(profiles.folderOf(WORK), 'settings.json'), '{}');

    const listing = await profiles.list();

    expect(listing.profiles).toEqual([]);
    expect(listing.problems).toHaveLength(1);
  });

  it('goes with the profile when it is deleted', async () => {
    await profiles.put({ id: WORK, name: 'Work' });
    await writeFile(path.join(profiles.folderOf(WORK), 'settings.json'), 'kept?');
    expect((await files.readProfile(WORK))?.text).toBe('kept?');

    await profiles.remove(WORK);

    expect(await files.readProfile(WORK)).toBeUndefined();
    await expect(lstat(path.join(profiles.folderOf(WORK), 'settings.json'))).rejects.toThrow();
  });
});
