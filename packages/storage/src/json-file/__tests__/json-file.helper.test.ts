import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { StorageFileError } from '../../errors/storage.errors.js';
import { expectPrivate, useTempFolder } from '../../testing/temp-folder.fake.js';
import { RENAME_ATTEMPTS } from '../json-file.constants.js';
import { readJsonFile, replaceFile, writeJsonFile } from '../json-file.helper.js';

const schema = z.object({ name: z.string(), count: z.number() });
/** Windows has no file modes: a test of one has nothing to check there. */
const hasFileModes = process.platform !== 'win32';

let file: string;

const temp = useTempFolder('storage-json-');

beforeEach(() => {
  file = path.join(temp.path(), 'data', 'thing.json');
});

describe('writeJsonFile and readJsonFile', () => {
  it('writes a file, creating its folders, and reads back what was written', async () => {
    await writeJsonFile({ file, value: { name: 'a', count: 1 } });

    expect(await readJsonFile({ file, schema, holdsSecrets: false })).toEqual({
      name: 'a',
      count: 1,
    });
  });

  it('writes readable JSON ending in a newline, so a person can open and edit it', async () => {
    await writeJsonFile({ file, value: { name: 'a', count: 1 } });

    const { readFile } = await import('node:fs/promises');
    const text = await readFile(file, 'utf8');

    expect(text).toBe('{\n  "name": "a",\n  "count": 1\n}\n');
  });

  it.skipIf(!hasFileModes)('keeps the file and the folders it made to the user alone', async () => {
    await writeJsonFile({ file, value: { name: 'a', count: 1 } });

    await expectPrivate(file);
  });

  it('replaces the file whole, and leaves no temp file behind', async () => {
    await writeJsonFile({ file, value: { name: 'old', count: 1 } });
    await writeJsonFile({ file, value: { name: 'new', count: 2 } });

    expect(await readJsonFile({ file, schema, holdsSecrets: false })).toEqual({
      name: 'new',
      count: 2,
    });
    expect(await readdir(path.dirname(file))).toEqual(['thing.json']);
  });

  it('survives writes to one file at the same moment: one of them, whole', async () => {
    const values = Array.from({ length: 25 }, (_, count) => ({ name: `writer ${count}`, count }));

    await Promise.all(values.map((value) => writeJsonFile({ file, value })));

    expect(values).toContainEqual(await readJsonFile({ file, schema, holdsSecrets: false }));
    expect(await readdir(path.dirname(file))).toEqual(['thing.json']);
  });

  it('removes its temp file and names the file when the write fails', async () => {
    // A folder where the file should go: the temp file is written, then cannot replace it.
    await mkdir(path.join(file, 'inside'), { recursive: true });

    const failure = await writeJsonFile({ file, value: { name: 'a', count: 1 } }).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(failure).toBeInstanceOf(StorageFileError);
    expect(failure).toMatchObject({ file });
    expect((failure as Error).message).toContain(file);
    expect(await readdir(path.dirname(file))).toEqual(['thing.json']);
  });
});

describe('readJsonFile', () => {
  it('says there is nothing for a file that is not there, or a folder that is not either', async () => {
    expect(await readJsonFile({ file, schema, holdsSecrets: false })).toBeUndefined();
    await writeFile(path.join(temp.path(), 'plain'), 'x');
    // A file where a folder should be is "not there" too, as on any system.
    expect(
      await readJsonFile({
        file: path.join(temp.path(), 'plain', 'x.json'),
        schema,
        holdsSecrets: false,
      }),
    ).toBeUndefined();
  });

  it('refuses what is not JSON, naming the file', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{ not json');

    await expect(readJsonFile({ file, schema, holdsSecrets: false })).rejects.toThrow(
      StorageFileError,
    );
    await expect(readJsonFile({ file, schema, holdsSecrets: false })).rejects.toThrow(file);
  });

  it('refuses JSON that is not what the schema says, naming the file and the field', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ name: 'a', count: 'many' }));

    const failure = await readJsonFile({ file, schema, holdsSecrets: false }).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(failure).toBeInstanceOf(StorageFileError);
    expect((failure as Error).message).toContain(file);
    expect((failure as Error).message).toContain('count');
  });

  it('does not take a folder for a missing file', async () => {
    await mkdir(file, { recursive: true });

    await expect(readJsonFile({ file, schema, holdsSecrets: false })).rejects.toThrow(
      StorageFileError,
    );
  });

  it('reads a file saved by hand on Windows: with a byte-order mark and CRLF line ends', async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '\uFEFF{\r\n  "name": "a",\r\n  "count": 1\r\n}\r\n');

    expect(await readJsonFile({ file, schema, holdsSecrets: false })).toEqual({
      name: 'a',
      count: 1,
    });
  });
});

describe('replaceFile', () => {
  const busy = (code: string) => Object.assign(new Error(code), { code });

  it('tries again while a file is held for a moment, then goes through', async () => {
    const calls: string[] = [];
    const rename = async (from: unknown) => {
      calls.push(String(from));

      if (calls.length < 3) throw busy('EPERM');
    };

    await replaceFile({ from: 'a', to: 'b', rename });

    expect(calls).toEqual(['a', 'a', 'a']);
  });

  it.each(['EPERM', 'EBUSY', 'EACCES'])(
    'gives up on %s that does not pass, after a few tries',
    async (code) => {
      let calls = 0;
      const rename = async () => {
        calls += 1;

        throw busy(code);
      };

      await expect(replaceFile({ from: 'a', to: 'b', rename })).rejects.toMatchObject({ code });
      expect(calls).toBe(RENAME_ATTEMPTS);
    },
  );

  it('throws any other error at once: a missing folder is not worth waiting for', async () => {
    let calls = 0;
    const rename = async () => {
      calls += 1;

      throw busy('ENOENT');
    };

    await expect(replaceFile({ from: 'a', to: 'b', rename })).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(calls).toBe(1);
  });
});
