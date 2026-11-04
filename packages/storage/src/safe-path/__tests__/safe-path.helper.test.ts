import { mkdir, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { StorageFileError, UnsafePathError } from '../../errors/storage.errors.js';
import { useTempFolder } from '../../testing/temp-folder.fake.js';
import { assertSafeRoot, namedPath, removeFile, removeFolder } from '../safe-path.helper.js';

const ID = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';
const OTHER = '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71';
const LINKED = '7d9a2c41-5e0b-4f63-8a17-3c6e9b1d4f20';
const temp = useTempFolder('safe-path-');
const canLink = process.platform !== 'win32';

const exists = async (target: string) => {
  try {
    await stat(target);

    return true;
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return false;
    throw caughtError;
  }
};

describe('assertSafeRoot', () => {
  it('hands back an absolute folder as it is', () => {
    expect(assertSafeRoot(temp.path())).toBe(temp.path());
  });

  it.each(['', 'relative/folder', '.', '..'])(
    'refuses %j, which is wherever the process runs',
    (root) => {
      expect(() => assertSafeRoot(root)).toThrow(UnsafePathError);
    },
  );

  it('refuses the top of a file system, and names it', () => {
    const top = path.parse(temp.path()).root;

    expect(() => assertSafeRoot(top)).toThrow(
      `Refusing to use ${top}: it is the root of a file system`,
    );
  });
});

describe('namedPath', () => {
  it('is the id and its extension inside the folder', () => {
    const folder = temp.path();

    expect(namedPath({ folder, id: ID, extension: '.json' })).toBe(path.join(folder, `${ID}.json`));
    expect(namedPath({ folder, id: ID })).toBe(path.join(folder, ID));
  });

  it('refuses a name that could reach another file, naming the path it was asked for', () => {
    const folder = temp.path();

    expect(() => namedPath({ folder, id: '../neighbour', extension: '.json' })).toThrow(
      `Refusing to use ${path.join(folder, '../neighbour.json')}: its name is not an id`,
    );
    expect(() => namedPath({ folder, id: ID, extension: '/../x' })).toThrow(UnsafePathError);
  });

  it('refuses a folder that is relative or the top of a file system', () => {
    expect(() => namedPath({ folder: 'models', id: ID })).toThrow(UnsafePathError);
    expect(() => namedPath({ folder: path.parse(temp.path()).root, id: ID })).toThrow(
      UnsafePathError,
    );
  });
});

/** A store folder with an id-named folder in it that holds a file, and a file beside them. */
async function populated() {
  const root = path.join(temp.path(), 'profiles');
  const folder = path.join(root, ID);

  await mkdir(path.join(folder, 'deep'), { recursive: true });
  await writeFile(path.join(folder, 'deep', 'kept.txt'), 'x');
  await mkdir(path.join(root, OTHER), { recursive: true });
  await writeFile(path.join(root, 'beside.txt'), 'x');

  return { root, folder };
}

describe('removeFolder', () => {
  it('deletes an id-named folder with everything in it, and nothing beside it', async () => {
    const { root, folder } = await populated();

    await removeFolder({ root, folder });

    expect(await exists(folder)).toBe(false);
    expect((await readdir(root)).sort()).toEqual([OTHER, 'beside.txt']);
  });

  it('is fine with a folder that is not there, and with a store folder that is not there', async () => {
    const { root } = await populated();

    await removeFolder({ root, folder: path.join(root, '00000000-0000-4000-8000-000000000000') });
    await removeFolder({
      root: path.join(temp.path(), 'no-such-store'),
      folder: path.join(temp.path(), 'no-such-store', ID),
    });
  });

  it('deletes what it checked: the path with its `..` applied', async () => {
    const { root, folder } = await populated();

    await removeFolder({ root, folder: path.join(root, OTHER, '..', ID) });

    expect(await exists(folder)).toBe(false);
    expect(await exists(path.join(root, OTHER))).toBe(true);
  });

  it('refuses what is not a store’s folder with an UnsafePathError, and deletes nothing', async () => {
    const { root, folder } = await populated();
    const dangerous = [
      '',
      ID,
      root,
      temp.path(),
      path.dirname(temp.path()),
      path.join(root, 'beside.txt'),
      path.join(root, ID, 'deep'),
      path.join(root, ID, '..', '..'),
      path.join(root, '..', ID),
      path.join('profiles', ID),
    ];

    for (const target of dangerous) {
      await expect(removeFolder({ root, folder: target })).rejects.toBeInstanceOf(UnsafePathError);
    }

    expect(await exists(path.join(folder, 'deep', 'kept.txt'))).toBe(true);
    expect(await exists(path.join(root, OTHER))).toBe(true);
    expect(await exists(path.join(root, 'beside.txt'))).toBe(true);
  });

  it('names the folder it refused, and why', async () => {
    const { root } = await populated();

    await expect(removeFolder({ root, folder: root })).rejects.toThrow(
      `Refusing to use ${root}: it is not directly inside its store’s folder`,
    );
  });

  it('refuses the home folder it is given, and the folder that holds it', async () => {
    const { root, folder } = await populated();

    await expect(removeFolder({ root, folder, home: folder })).rejects.toBeInstanceOf(
      UnsafePathError,
    );
    await expect(
      removeFolder({ root, folder, home: path.join(folder, 'deep') }),
    ).rejects.toBeInstanceOf(UnsafePathError);
    expect(await exists(path.join(folder, 'deep', 'kept.txt'))).toBe(true);
  });

  it.skipIf(!canLink)(
    'removes a folder that is a link as the link only, never its target',
    async () => {
      const { root } = await populated();
      const elsewhere = path.join(temp.path(), 'elsewhere');

      await mkdir(elsewhere);
      await writeFile(path.join(elsewhere, 'precious.txt'), 'x');
      await symlink(elsewhere, path.join(root, LINKED), 'dir');

      await removeFolder({ root, folder: path.join(root, LINKED) });

      expect(await exists(path.join(root, LINKED))).toBe(false);
      expect(await exists(path.join(elsewhere, 'precious.txt'))).toBe(true);
    },
  );

  it.skipIf(!canLink)(
    'refuses a store folder that really is the top of a file system',
    async () => {
      const link = path.join(temp.path(), 'looks-harmless');

      await symlink(path.parse(temp.path()).root, link, 'dir');

      await expect(removeFolder({ root: link, folder: path.join(link, ID) })).rejects.toThrow(
        /really is/,
      );
    },
  );
});

describe('removeFile', () => {
  /** A models folder with two models and a neighbour file beside the folder, which must stay. */
  async function models() {
    const profile = temp.path();
    const folder = path.join(profile, 'models');

    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `${ID}.json`), 'x');
    await writeFile(path.join(folder, `${OTHER}.json`), 'x');
    await writeFile(path.join(folder, `${ID}.txt`), 'x');
    await writeFile(path.join(profile, 'neighbour.json'), 'x');

    return { profile, folder };
  }

  it('deletes the one file it names, and nothing beside it', async () => {
    const { folder } = await models();

    await removeFile({ folder, id: ID, extension: '.json' });

    expect((await readdir(folder)).sort()).toEqual([`${ID}.txt`, `${OTHER}.json`]);
  });

  it('is fine with a file that is not there, and with a folder that is not there', async () => {
    const { folder } = await models();

    await removeFile({ folder, id: '00000000-0000-4000-8000-000000000000', extension: '.json' });
    await removeFile({ folder: path.join(folder, 'nope'), id: ID, extension: '.json' });
    expect(await readdir(folder)).toHaveLength(3);
  });

  it('refuses a name that could reach another file, and leaves every file in place', async () => {
    const { profile, folder } = await models();
    const names = ['../neighbour', `../${ID}`, '..', '.', '', '*', 'work', ID.toUpperCase()];

    for (const id of names) {
      await expect(removeFile({ folder, id, extension: '.json' })).rejects.toBeInstanceOf(
        UnsafePathError,
      );
    }

    await expect(removeFile({ folder, id: ID, extension: '/../neighbour.json' })).rejects.toThrow(
      UnsafePathError,
    );
    await expect(removeFile({ folder: 'models', id: ID, extension: '.json' })).rejects.toThrow(
      UnsafePathError,
    );

    expect(await exists(path.join(profile, 'neighbour.json'))).toBe(true);
    expect(await readdir(folder)).toHaveLength(3);
  });

  it('never removes a folder: one named like a file is left with its contents, and it throws', async () => {
    const { folder } = await models();
    const lookalike = path.join(folder, `${LINKED}.json`);

    await mkdir(lookalike);
    await writeFile(path.join(lookalike, 'inside.txt'), 'x');

    await expect(removeFile({ folder, id: LINKED, extension: '.json' })).rejects.toBeInstanceOf(
      StorageFileError,
    );
    expect(await exists(path.join(lookalike, 'inside.txt'))).toBe(true);
  });

  it.skipIf(!canLink)('refuses a folder that really is the top of a file system', async () => {
    const link = path.join(temp.path(), 'looks-harmless');

    await symlink(path.parse(temp.path()).root, link, 'dir');

    await expect(removeFile({ folder: link, id: ID, extension: '.json' })).rejects.toThrow(
      /really is/,
    );
  });
});
