import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../../config-store/config-store.service.js';
import { CredentialStore } from '../../credential-store/credential-store.service.js';
import { FileConversationStore } from '../../conversation-store/conversation-store.service.js';
import { DocumentFile } from '../../document-file/document-file.service.js';
import { UnsafePathError } from '../../errors/storage.errors.js';
import { ModelStore } from '../../model-store/model-store.service.js';
import { ProfileRegistry } from '../../profile-registry/profile-registry.service.js';
import { ProfileStore } from '../../profile-store/profile-store.service.js';
import { twoModels } from '../../testing/registry.fake.js';

/**
 * Calls `store[name](...args)` with whatever it is given. A store's methods take a branded id, and
 * a brand can only be made by parsing, so the type system itself never hands a store a bad one. A
 * caller that never parsed (plain JS, a value that came from outside and was passed on) can, and it
 * is that caller these tests are: they cannot fake validity with a cast, and don't need to.
 */
function call(store: object, name: string, ...args: unknown[]): unknown {
  const method = Reflect.get(store, name) as (...given: unknown[]) => unknown;

  return Reflect.apply(method, store, args);
}

const UNSAFE = ['../neighbour', '..', '', 'a/b', '../../../tmp/x'];
let base = '';

/** Every one of `UNSAFE`, given to `store[name]` as the id (or in `argsFor`), is refused. */
async function expectEveryUnsafeIdRefused(params: {
  store: object;
  name: string;
  argsFor?: (id: string) => unknown[];
}): Promise<void> {
  const { store, name, argsFor = (id) => [id] } = params;

  for (const id of UNSAFE) {
    await expect(call(store, name, ...argsFor(id))).rejects.toBeInstanceOf(UnsafePathError);
  }
}

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'safe-stores-'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('every store checks the folder it is given', () => {
  const builds: [string, (root: string) => unknown][] = [
    ['ModelStore', (folder) => new ModelStore({ folder })],
    ['CredentialStore', (folder) => new CredentialStore({ folder })],
    ['ConfigStore', (root) => new ConfigStore({ root })],
    ['ProfileStore', (root) => new ProfileStore({ root })],
    ['ProfileRegistry', (root) => new ProfileRegistry({ root })],
    [
      'FileConversationStore',
      (folder) => new FileConversationStore({ folder, onProblem: () => 0 }),
    ],
    ['DocumentFile', (file) => new DocumentFile({ file })],
  ];

  it.each(builds)(
    '%s refuses a relative folder, which is wherever the process runs',
    (_name, build) => {
      for (const relative of ['', 'relative', '.', path.join('..', 'sheavly')]) {
        expect(() => build(relative)).toThrow(UnsafePathError);
      }
    },
  );

  it.each(builds)('%s refuses the top of a file system', (_name, build) => {
    expect(() => build(path.parse(tmpdir()).root)).toThrow(UnsafePathError);
  });

  it.each(builds)('%s accepts an absolute folder', (_name, build) => {
    expect(() => build(path.join(base, 'sheavly'))).not.toThrow();
  });
});

describe('a store names its files from ids it checks, not from the type of the id', () => {
  const { astra } = twoModels();

  it('ModelStore refuses an id that could reach another file, on get, put and remove alike', async () => {
    const store = new ModelStore({ folder: base });

    await expectEveryUnsafeIdRefused({ store, name: 'get' });
    await expectEveryUnsafeIdRefused({ store, name: 'put', argsFor: (id) => [{ ...astra, id }] });
    await expectEveryUnsafeIdRefused({ store, name: 'remove' });

    // Nothing was written, not even the folder: a refused name makes nothing.
    expect(await readdir(base)).toEqual([]);
  });

  it('ProfileStore refuses an id that could reach another folder, on folderOf, get, put and remove', async () => {
    const store = new ProfileStore({ root: base });

    for (const id of UNSAFE) {
      expect(() => call(store, 'folderOf', id)).toThrow(UnsafePathError);
    }

    await expectEveryUnsafeIdRefused({ store, name: 'get' });
    await expectEveryUnsafeIdRefused({ store, name: 'put', argsFor: (id) => [{ id, name: 'x' }] });
    await expectEveryUnsafeIdRefused({ store, name: 'remove' });

    expect(await readdir(base)).toEqual([]);
  });
});
