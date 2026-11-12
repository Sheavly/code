import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { StorageFileError } from '../../errors/storage.errors.js';
import { expectPrivate, useTempFolder } from '../../testing/temp-folder.fake.js';
import { DocumentFile } from '../document-file.service.js';

const temp = useTempFolder('document-file-');
const canChmod = process.platform !== 'win32' && process.getuid?.() !== 0;

const open = () => new DocumentFile({ file: path.join(temp.path(), 'config', 'doc.json') });

describe('DocumentFile', () => {
  it('has nothing stored before the first change, and no file made by looking', async () => {
    const document = open();

    expect(await document.load()).toBeUndefined();
    await expect(readFile(document.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps what a change makes, which the next change and a new reader both see', async () => {
    const document = open();

    await document.update(() => ({ count: 1 }));
    await document.update((current) => ({ count: (current as { count: number }).count + 1 }));

    expect(await document.load()).toEqual({ count: 2 });
    expect(await open().load()).toEqual({ count: 2 });
  });

  it('stores nothing when a change returns nothing, and when it throws', async () => {
    const document = open();

    await document.update(() => undefined);
    await expect(readFile(document.file)).rejects.toMatchObject({ code: 'ENOENT' });

    await document.update(() => ({ kept: true }));
    await expect(
      document.update(() => {
        throw new RangeError('refused');
      }),
    ).rejects.toThrow('refused');
    await document.update(() => undefined);

    expect(await document.load()).toEqual({ kept: true });
  });

  it('applies changes sent together one after another, none erasing another', async () => {
    const document = open();

    const empty: { values: number[] } = { values: [] };

    await document.update(() => empty);
    await Promise.all(
      Array.from({ length: 30 }, (_, value) =>
        document.update((current) => {
          const { values } = current as { values: number[] };

          return { values: [...values, value] };
        }),
      ),
    );

    const { values } = (await document.load()) as { values: number[] };

    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it('keeps a failed change from stopping the ones after it', async () => {
    const document = open();
    const failing = document.update(() => {
      throw new RangeError('refused');
    });
    const following = document.update(() => ({ ok: true }));

    await expect(failing).rejects.toThrow('refused');
    await following;

    expect(await document.load()).toEqual({ ok: true });
  });

  it('names the file for one that is not JSON, and does not replace it on the next change', async () => {
    const document = open();

    await mkdir(path.dirname(document.file), { recursive: true });
    await writeFile(document.file, '{ nope');

    await expect(document.load()).rejects.toBeInstanceOf(StorageFileError);
    await expect(document.load()).rejects.toThrow(document.file);
    await expect(document.update(() => ({ replaced: true }))).rejects.toBeInstanceOf(
      StorageFileError,
    );
    expect(await readFile(document.file, 'utf8')).toBe('{ nope');
  });

  it('does not quote the text of a damaged document in its error: it may be private', async () => {
    const document = open();

    await mkdir(path.dirname(document.file), { recursive: true });
    await writeFile(document.file, '{ "queued": ["my secret token sk-abc123" nope }');

    const failure = await document.load().then(
      () => undefined,
      (caughtError: unknown) => caughtError as Error,
    );

    expect(failure).toBeInstanceOf(StorageFileError);
    expect(JSON.stringify([failure?.message, failure?.cause])).not.toContain('sk-abc123');
  });

  it.skipIf(!canChmod)(
    'writes it private to the user, in a folder private to the user',
    async () => {
      const document = open();

      await document.update(() => ({ a: 1 }));

      await expectPrivate(document.file);
    },
  );

  it.skipIf(!canChmod)('reports a file it cannot write, naming it', async () => {
    const document = open();

    await document.update(() => ({ a: 1 }));
    await chmod(path.dirname(document.file), 0o500);

    try {
      await expect(document.update(() => ({ a: 2 }))).rejects.toThrow(document.file);
    } finally {
      await chmod(path.dirname(document.file), 0o700);
    }
  });
});
