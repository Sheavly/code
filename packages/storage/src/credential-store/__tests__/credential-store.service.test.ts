import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { StorageFileError } from '../../errors/storage.errors.js';
import { CredentialStore } from '../credential-store.service.js';

/** A key no other string could be: finding it anywhere it should not be means it leaked. */
const KEY = 'sk-LEAK-CHECK-7d41c9e0a2';
const ASTRA = modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
const BORA = modelIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71');
/** Windows has no file modes: a test of one has nothing to check there. */
const hasFileModes = process.platform !== 'win32';

let profile: string;
let file: string;
let store: CredentialStore;

/** Every message in an error and its causes, to look for a key in. */
function everythingSaid(error: unknown): string {
  const parts: string[] = [];

  for (let current = error; current instanceof Error; current = current.cause) {
    parts.push(current.name, current.message, current.stack ?? '');
  }

  return parts.join('\n');
}

const failureOf = (run: () => Promise<unknown>) =>
  run().then(
    () => undefined,
    (caughtError: unknown) => caughtError,
  );

beforeEach(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'storage-credentials-'));
  file = path.join(profile, 'credentials.json');
  store = new CredentialStore({ folder: profile });
});

afterEach(async () => {
  await rm(profile, { recursive: true, force: true });
});

describe('CredentialStore', () => {
  it('has no secrets before any is set', async () => {
    expect(await store.get(ASTRA)).toBeUndefined();
    expect(await store.fieldsSet()).toEqual({});
  });

  it('keeps a model’s secrets by id, and replaces them when set again', async () => {
    await store.put({ id: ASTRA, secrets: { apiKey: KEY } });
    await store.put({ id: BORA, secrets: { apiKey: 'other' } });

    expect(await store.get(ASTRA)).toEqual({ apiKey: KEY });

    await store.put({ id: ASTRA, secrets: { apiKey: 'rotated' } });

    expect(await store.get(ASTRA)).toEqual({ apiKey: 'rotated' });
    expect(await store.get(BORA)).toEqual({ apiKey: 'other' });
  });

  it('forgets one model’s secrets and leaves the others; forgetting none is fine', async () => {
    await store.put({ id: ASTRA, secrets: { apiKey: KEY } });
    await store.put({ id: BORA, secrets: { apiKey: 'other' } });
    await store.remove(ASTRA);
    await store.remove(ASTRA);

    expect(await store.get(ASTRA)).toBeUndefined();
    expect(await store.get(BORA)).toEqual({ apiKey: 'other' });
  });

  it('says which fields are set and never what they hold', async () => {
    await store.put({ id: ASTRA, secrets: { apiKey: KEY, organization: 'org-secret' } });

    const set = await store.fieldsSet();

    expect(set).toEqual({ [ASTRA]: ['apiKey', 'organization'] });
    expect(JSON.stringify(set)).not.toContain(KEY);
    expect(JSON.stringify(set)).not.toContain('org-secret');
  });

  it('does not lose a key when many are set at the same moment', async () => {
    const ids = Array.from({ length: 20 }, (_, index) =>
      modelIdSchema.parse(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    );

    await Promise.all(ids.map((id) => store.put({ id, secrets: { apiKey: `key-${id}` } })));

    for (const id of ids) expect(await store.get(id)).toEqual({ apiKey: `key-${id}` });
  });

  it('keeps going after a write that failed: the next one is not stuck behind it', async () => {
    await writeFile(file, '{ not json');

    expect(
      await failureOf(async () => store.put({ id: ASTRA, secrets: { apiKey: KEY } })),
    ).toBeInstanceOf(StorageFileError);

    await rm(file);
    await store.put({ id: BORA, secrets: { apiKey: 'fine' } });

    expect(await store.get(BORA)).toEqual({ apiKey: 'fine' });
  });
});

describe.skipIf(!hasFileModes)('CredentialStore permissions', () => {
  it('writes the file, and the folder it makes, to the user alone', async () => {
    const nested = new CredentialStore({ folder: path.join(profile, 'profiles', 'work') });

    await nested.put({ id: ASTRA, secrets: { apiKey: KEY } });

    const written = path.join(profile, 'profiles', 'work', 'credentials.json');

    expect((await stat(written)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(written))).mode & 0o777).toBe(0o700);
  });

  it('keeps the file private when it replaces one that was open', async () => {
    await store.put({ id: ASTRA, secrets: { apiKey: KEY } });
    await store.put({ id: BORA, secrets: { apiKey: 'other' } });

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it.each([0o644, 0o640, 0o604, 0o660, 0o666])(
    'refuses a file that others can read (mode %o), and says to replace what is in it',
    async (mode) => {
      await store.put({ id: ASTRA, secrets: { apiKey: KEY } });
      await chmod(file, mode);

      for (const run of [
        async () => store.get(ASTRA),
        async () => store.fieldsSet(),
        async () => store.put({ id: BORA, secrets: { apiKey: 'x' } }),
        async () => store.remove(ASTRA),
      ]) {
        const failure = await failureOf(run);

        expect(failure).toBeInstanceOf(StorageFileError);
        expect((failure as Error).message).toContain(file);
        expect((failure as Error).message).toContain('chmod 600');
        expect((failure as Error).message).toContain('replace');
        expect(everythingSaid(failure)).not.toContain(KEY);
      }

      // Refused, not changed: the file is left as it was found, for the user to deal with.
      expect((await stat(file)).mode & 0o777).toBe(mode);
      expect(await readFile(file, 'utf8')).toContain(KEY);
    },
  );

  it('accepts a file only its owner can use, however strict', async () => {
    await store.put({ id: ASTRA, secrets: { apiKey: KEY } });

    for (const mode of [0o600, 0o400]) {
      await chmod(file, mode);
      expect(await store.get(ASTRA)).toEqual({ apiKey: KEY });
    }
  });
});

describe('CredentialStore with a file that is not right', () => {
  it('does not show the text of a file that is not JSON: it has keys in it', async () => {
    await writeFile(file, `{ "${ASTRA}": { "apiKey": "${KEY}" `, { mode: 0o600 });

    const failure = await failureOf(async () => store.get(ASTRA));

    expect(failure).toBeInstanceOf(StorageFileError);
    expect((failure as Error).message).toContain(file);
    // Node's own parse error quotes the text around the fault: not even as a cause.
    expect(everythingSaid(failure)).not.toContain(KEY);
    expect((failure as Error).cause).toBeUndefined();
  });

  it('does not show a key from a file with the wrong shape, only where it is wrong', async () => {
    await writeFile(file, JSON.stringify({ [ASTRA]: { apiKey: 42, other: KEY } }), { mode: 0o600 });

    const failure = await failureOf(async () => store.get(ASTRA));

    expect(failure).toBeInstanceOf(StorageFileError);
    expect((failure as Error).message).toContain('apiKey');
    expect(everythingSaid(failure)).not.toContain(KEY);
  });

  it('refuses a model id that is not one, and an empty secret', async () => {
    await writeFile(file, JSON.stringify({ 'my-model': { apiKey: KEY } }), { mode: 0o600 });
    expect(await failureOf(async () => store.get(ASTRA))).toBeInstanceOf(StorageFileError);

    await writeFile(file, JSON.stringify({ [ASTRA]: { apiKey: '' } }), { mode: 0o600 });
    expect(await failureOf(async () => store.get(ASTRA))).toBeInstanceOf(StorageFileError);
  });

  it('never starts from an empty file over one it cannot read: nothing is overwritten', async () => {
    const damaged = `{ "${ASTRA}": { "apiKey": "${KEY}" `;

    await writeFile(file, damaged, { mode: 0o600 });

    expect(
      await failureOf(async () => store.put({ id: BORA, secrets: { apiKey: 'x' } })),
    ).toBeInstanceOf(StorageFileError);
    expect(await readFile(file, 'utf8')).toBe(damaged);
  });

  it('reads a file saved by hand on Windows: with a byte-order mark and CRLF line ends', async () => {
    const text = JSON.stringify({ [ASTRA]: { apiKey: KEY } }, null, 2).replaceAll('\n', '\r\n');

    await writeFile(file, `\uFEFF${text}\r\n`, { mode: 0o600 });

    expect(await store.get(ASTRA)).toEqual({ apiKey: KEY });
  });
});
