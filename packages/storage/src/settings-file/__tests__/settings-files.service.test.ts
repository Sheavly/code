import { mkdir, chmod, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { StorageFileError } from '../../errors/storage.errors.js';
import { MAX_SETTINGS_FILE_BYTES } from '../settings-file.constants.js';
import { SettingsFiles } from '../settings-files.service.js';

const WORK = profileIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
const OTHER = profileIdSchema.parse('c1e8a3d4-7b25-4e69-8f10-2a6d9b4c7e53');
const SECRET = 'sk-live-do-not-leak-0123456789';
let root: string;
let files: SettingsFiles;

const globalFile = () => path.join(root, 'settings.json');
const profileFile = (id: string) => path.join(root, 'profiles', id, 'settings.json');

async function put(file: string, content: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'storage-settings-'));
  files = new SettingsFiles({ root });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('SettingsFiles: the global and the profile file', () => {
  it('has no text, an empty layer, before anything is written', async () => {
    expect(await files.readGlobal()).toBeUndefined();
    expect(await files.readProfile(WORK)).toBeUndefined();
  });

  it('reads the global file as text with its path, without parsing it', async () => {
    await put(globalFile(), 'not even json');

    expect(await files.readGlobal()).toEqual({ text: 'not even json', file: globalFile() });
  });

  it('reads a profile file as text with its path', async () => {
    await put(profileFile(WORK), '{ "settings": {} }');

    expect(await files.readProfile(WORK)).toEqual({
      text: '{ "settings": {} }',
      file: profileFile(WORK),
    });
  });

  it('keeps the two files apart, and one profile apart from another', async () => {
    await put(globalFile(), 'global');
    await put(profileFile(WORK), 'work');

    expect((await files.readGlobal())?.text).toBe('global');
    expect((await files.readProfile(WORK))?.text).toBe('work');
    expect(await files.readProfile(OTHER)).toBeUndefined();
  });

  it('reads a profile that has a folder but no settings file as empty', async () => {
    await mkdir(path.join(root, 'profiles', WORK), { recursive: true });

    expect(await files.readProfile(WORK)).toBeUndefined();
  });
});

describe('SettingsFiles: a file that cannot be used', () => {
  /** The error names the file and the reason and holds none of what the file contains. */
  async function failureOf(read: () => Promise<unknown>): Promise<StorageFileError> {
    const caught = await read().then(
      () => undefined,
      (caughtError: unknown) => caughtError,
    );

    expect(caught).toBeInstanceOf(StorageFileError);

    return caught as StorageFileError;
  }

  it('refuses a settings.json that is a directory, naming it', async () => {
    await mkdir(globalFile());

    const error = await failureOf(() => files.readGlobal());

    expect(error.file).toBe(globalFile());
    expect(error.message).toContain('not a regular file');
  });

  it('refuses a file over the cap, naming the path and the cap and never the content', async () => {
    await put(profileFile(WORK), `${SECRET}${' '.repeat(MAX_SETTINGS_FILE_BYTES)}`);

    const error = await failureOf(() => files.readProfile(WORK));

    expect(error.file).toBe(profileFile(WORK));
    expect(error.message).toContain(String(MAX_SETTINGS_FILE_BYTES));
    expect(error.message).not.toContain(SECRET);
  });

  it('reads a file of exactly the cap', async () => {
    await put(globalFile(), ' '.repeat(MAX_SETTINGS_FILE_BYTES));

    expect((await files.readGlobal())?.text).toHaveLength(MAX_SETTINGS_FILE_BYTES);
  });

  it('refuses bytes that are not UTF-8, never showing them', async () => {
    await put(globalFile(), Buffer.from([...Buffer.from(SECRET), 0xff, 0xfe, 0xc3]));

    const error = await failureOf(() => files.readGlobal());

    expect(error.message).toContain('UTF-8');
    expect(error.message).not.toContain(SECRET);
    expect(error.file).toBe(globalFile());
  });

  // A process running as root, or Windows, reads a file with no permissions, so the test could
  // not fail there: it passes only where the system enforces the mode.
  const enforcesModes = process.platform !== 'win32' && process.getuid?.() !== 0;

  it.skipIf(!enforcesModes)(
    'refuses a file it may not read, naming it and not its content',
    async () => {
      await put(globalFile(), SECRET);
      await chmod(globalFile(), 0o000);

      const error = await failureOf(() => files.readGlobal());

      expect(error.file).toBe(globalFile());
      expect(error.message).not.toContain(SECRET);
    },
  );
});

describe('SettingsFiles: a profile id from outside', () => {
  const refused = ['..', '../..', 'a/b', '/etc', '', '.', `${WORK}/..`, 'WORK', `..\\${WORK}`];

  it.each(refused)('refuses %j without reading anything', async (profileId) => {
    // A file where `..` would lead: it must never be read.
    await put(path.join(root, 'settings.json'), SECRET);
    await put(path.join(root, 'profiles', 'settings.json'), SECRET);

    await expect(files.readProfile(profileId)).rejects.toThrow(/not a profile id/);
  });
});
