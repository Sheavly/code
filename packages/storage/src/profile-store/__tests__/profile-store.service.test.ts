import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { StorageFileError } from '../../errors/storage.errors.js';
import { ProfileStore } from '../profile-store.service.js';

const WORK = profileIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
const HOME = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71');
const OTHER = profileIdSchema.parse('c1e8a3d4-7b25-4e69-8f10-2a6d9b4c7e53');
const work = { id: WORK, name: 'Work' };
const home = { id: HOME, name: 'Home' };
/** Symbolic links need a privilege on Windows that tests can't count on. */
const hasSymlinks = process.platform !== 'win32';

let root: string;
let profiles: string;
let store: ProfileStore;

const folderOf = (id: string) => path.join(profiles, id);
const exists = async (target: string) => {
  try {
    await lstat(target);

    return true;
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return false;
    throw caughtError;
  }
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'storage-profiles-'));
  profiles = path.join(root, 'profiles');
  store = new ProfileStore({ root });
});

/** A folder outside the profiles with a file in it that no delete may touch. */
async function folderToKeep() {
  const elsewhere = path.join(root, 'elsewhere');

  await mkdir(elsewhere);
  await writeFile(path.join(elsewhere, 'keep.txt'), 'mine');

  return elsewhere;
}

/** The profile is gone, and the folder kept outside it was neither emptied nor deleted. */
async function expectGoneAndUntouched(kept: string) {
  expect(await exists(folderOf(WORK))).toBe(false);
  expect(await readFile(path.join(kept, 'keep.txt'), 'utf8')).toBe('mine');
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('ProfileStore', () => {
  it('has no profiles, and no problems, before anything is stored', async () => {
    expect(await store.list()).toEqual({ profiles: [], problems: [] });
    expect(await store.get(WORK)).toBeUndefined();
  });

  it('keeps a profile as profiles/<id>/profile.json, flat so a person can read it', async () => {
    await store.put(work);

    expect(JSON.parse(await readFile(path.join(folderOf(WORK), 'profile.json'), 'utf8'))).toEqual({
      id: WORK,
      name: 'Work',
    });
    expect(await store.get(WORK)).toEqual(work);
    expect(await store.list()).toEqual({ profiles: [work], problems: [] });
    expect(store.folderOf(WORK)).toBe(folderOf(WORK));
  });

  it('renames a profile in place: the folder, and so everything in it, stays', async () => {
    await store.put(work);
    await mkdir(path.join(folderOf(WORK), 'models'));
    await writeFile(path.join(folderOf(WORK), 'models', 'm.json'), '{}');
    await store.put({ id: WORK, name: 'Day job' });

    expect((await store.get(WORK))?.name).toBe('Day job');
    expect(await exists(path.join(folderOf(WORK), 'models', 'm.json'))).toBe(true);
  });

  it('lists by name, then id, and lets two profiles share a name: it is only a label', async () => {
    await store.put({ id: OTHER, name: 'Work' });
    await store.put(home);
    await store.put(work);

    expect((await store.list()).profiles.map((profile) => profile.id)).toEqual([HOME, WORK, OTHER]);
  });

  it('does not lose a profile when many are stored at the same moment', async () => {
    const all = Array.from({ length: 20 }, (_, index) => ({
      id: profileIdSchema.parse(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
      name: `Profile ${String(index)}`,
    }));

    await Promise.all(all.map((profile) => store.put(profile)));

    expect((await store.list()).profiles).toHaveLength(20);
  });
});

describe('ProfileStore.remove', () => {
  /** A profile with what a real one holds: models, a key, conversations. */
  async function fill(profile: typeof work) {
    await store.put(profile);

    const folder = folderOf(profile.id);

    await mkdir(path.join(folder, 'models'), { recursive: true });
    await mkdir(path.join(folder, 'workspaces', 'a'.repeat(64), 'conversations'), {
      recursive: true,
    });
    await writeFile(path.join(folder, 'models', 'm.json'), '{}');
    await writeFile(path.join(folder, 'secrets.dat'), 'sk-secret');
    await writeFile(
      path.join(folder, 'workspaces', 'a'.repeat(64), 'conversations', 'c.jsonl'),
      '{}\n',
    );
  }

  it('deletes the folder and all of it: models, keys and conversations', async () => {
    await fill(work);
    await store.remove(WORK);

    expect(await exists(folderOf(WORK))).toBe(false);
    expect(await store.get(WORK)).toBeUndefined();
    expect((await store.list()).profiles).toEqual([]);
  });

  it('leaves the other profiles, and the files beside the profiles folder, alone', async () => {
    await fill(work);
    await fill(home);
    await writeFile(path.join(root, 'config.json'), '{}');
    await writeFile(path.join(profiles, 'notes.txt'), 'x');
    await store.remove(WORK);

    expect((await store.list()).profiles).toEqual([home]);
    expect(await exists(path.join(folderOf(HOME), 'secrets.dat'))).toBe(true);
    expect(await readFile(path.join(root, 'config.json'), 'utf8')).toBe('{}');
    expect(await exists(path.join(profiles, 'notes.txt'))).toBe(true);
  });

  it('deleting a profile that is not there is fine, and so is deleting it twice', async () => {
    await store.remove(WORK);
    await fill(work);
    await store.remove(WORK);
    await store.remove(WORK);

    expect(await exists(folderOf(WORK))).toBe(false);
  });

  it.skipIf(!hasSymlinks)(
    'removes a profile folder that is a link as the link only, never what it points to',
    async () => {
      const elsewhere = await folderToKeep();

      await writeFile(path.join(elsewhere, 'profile.json'), JSON.stringify(work));
      await mkdir(profiles, { recursive: true });
      await symlink(elsewhere, folderOf(WORK), 'dir');
      await store.remove(WORK);

      await expectGoneAndUntouched(elsewhere);
      expect(await exists(path.join(elsewhere, 'profile.json'))).toBe(true);
    },
  );

  it.skipIf(!hasSymlinks)('does not follow a link inside the profile out of it', async () => {
    const elsewhere = await folderToKeep();

    await fill(work);
    await symlink(elsewhere, path.join(folderOf(WORK), 'workspaces', 'link'), 'dir');
    await store.remove(WORK);

    await expectGoneAndUntouched(elsewhere);
  });

  it('cannot be pointed at another folder: an id is a UUID, and nothing else is accepted', () => {
    // The id is parsed before it is a path, so these never reach a delete.
    for (const bad of ['..', '../config', '', '.', `${WORK}/..`, 'work', WORK.toUpperCase()]) {
      expect(profileIdSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('ProfileStore with folders edited by hand', () => {
  beforeEach(async () => {
    await mkdir(profiles, { recursive: true });
  });

  it('reports a folder named for no id, and one without a profile.json, and lists the rest', async () => {
    await store.put(work);
    await mkdir(folderOf('my-profile'));
    await mkdir(folderOf(HOME));

    const { profiles: listed, problems } = await store.list();

    expect(listed).toEqual([work]);
    expect(problems).toEqual([
      { file: folderOf(HOME), message: expect.stringContaining('no profile.json') as string },
      {
        file: folderOf('my-profile'),
        message: expect.stringContaining('not a profile id') as string,
      },
    ]);
  });

  it('reports a damaged profile.json by its path and still lists the others', async () => {
    await store.put(work);
    await mkdir(folderOf(HOME));
    await writeFile(path.join(folderOf(HOME), 'profile.json'), '{ "id": ');

    const { profiles: listed, problems } = await store.list();

    expect(listed).toEqual([work]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe(path.join(folderOf(HOME), 'profile.json'));
  });

  it('refuses a copy: a folder whose profile.json holds another id is not served under its name', async () => {
    await store.put(work);
    await mkdir(folderOf(HOME));
    await writeFile(path.join(folderOf(HOME), 'profile.json'), JSON.stringify(work));

    const { profiles: listed, problems } = await store.list();

    expect(listed).toEqual([work]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(WORK);
    await expect(store.get(HOME)).rejects.toThrow(StorageFileError);
  });

  it('asking for a profile whose folder is empty finds none, but a damaged one is an error', async () => {
    await mkdir(folderOf(WORK));
    expect(await store.get(WORK)).toBeUndefined();

    await writeFile(path.join(folderOf(WORK), 'profile.json'), 'not json');
    await expect(store.get(WORK)).rejects.toThrow(StorageFileError);
  });

  it('ignores what systems and editors leave: files, hidden folders, Thumbs.db', async () => {
    await store.put(work);

    for (const litter of ['.DS_Store', 'Thumbs.db', 'desktop.ini', 'notes.txt']) {
      await writeFile(path.join(profiles, litter), 'x');
    }

    await mkdir(path.join(profiles, '.git'));
    await mkdir(path.join(profiles, '.Trash'));

    expect(await store.list()).toEqual({ profiles: [work], problems: [] });
  });

  it.skipIf(!hasSymlinks)(
    'lists a profile whose folder is a link, as one kept in a synced folder is',
    async () => {
      const synced = path.join(root, 'synced');

      await mkdir(synced);
      await writeFile(path.join(synced, 'profile.json'), JSON.stringify(work));
      await symlink(synced, folderOf(WORK), 'dir');

      expect(await store.list()).toEqual({ profiles: [work], problems: [] });
      expect(await store.get(WORK)).toEqual(work);
    },
  );

  it('reads a profile.json a Windows editor saved: with a byte-order mark and CRLF line ends', async () => {
    await mkdir(folderOf(WORK));
    await writeFile(
      path.join(folderOf(WORK), 'profile.json'),
      `\uFEFF{\r\n  "id": "${WORK}",\r\n  "name": "Work"\r\n}\r\n`,
    );

    expect(await store.get(WORK)).toEqual(work);
  });

  it('does not take a file named like a profile for one, and refuses a name with nothing in it', async () => {
    await writeFile(folderOf(WORK), 'a file, not a folder');
    expect(await store.list()).toEqual({ profiles: [], problems: [] });

    await rm(folderOf(WORK));
    await mkdir(folderOf(WORK));
    await writeFile(
      path.join(folderOf(WORK), 'profile.json'),
      JSON.stringify({ id: WORK, name: '  ' }),
    );
    await expect(store.get(WORK)).rejects.toThrow(StorageFileError);
  });

  it('lists nothing when the profiles folder is not a folder, but cannot store into it', async () => {
    await rm(profiles, { recursive: true });
    await writeFile(profiles, 'not a folder');

    expect(await store.list()).toEqual({ profiles: [], problems: [] });
    await expect(store.put(work)).rejects.toThrow(StorageFileError);
    expect(await readdir(root)).toContain('profiles');
  });
});
