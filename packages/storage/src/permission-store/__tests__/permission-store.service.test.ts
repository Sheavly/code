import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workspaceKey } from '../../config-store/config-store.utils.js';
import { StorageFileError } from '../../errors/storage.errors.js';
import { PermissionStore } from '../permission-store.service.js';

const app = '/code/app';
const site = '/code/site';

let root: string;
let store: PermissionStore;

const fileOf = (realPath: string) =>
  path.join(root, 'permissions', `${workspaceKey({ realPath })}.json`);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'storage-permissions-'));
  store = new PermissionStore({ root });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('PermissionStore', () => {
  it('starts every workspace on ask, with nothing allowed, and writes nothing to find out', async () => {
    expect(await store.read(app)).toEqual({ mode: 'ask', allow: [] });
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('keeps a mode, per workspace', async () => {
    await store.setMode({ realPath: app, mode: 'allow_all' });

    expect(await store.read(app)).toEqual({ mode: 'allow_all', allow: [] });
    expect(await store.read(site)).toEqual({ mode: 'ask', allow: [] });
  });

  it('allows a command once, in order, and keeps the mode it had', async () => {
    await store.setMode({ realPath: app, mode: 'always_ask' });
    await store.allow({ realPath: app, entry: 'git log *' });
    await store.allow({ realPath: app, entry: 'npm run test *' });
    await store.allow({ realPath: app, entry: 'git log *' });

    expect(await store.read(app)).toEqual({
      mode: 'always_ask',
      allow: ['git log *', 'npm run test *'],
    });
  });

  it('revokes a command, and does not mind one that was never allowed', async () => {
    await store.allow({ realPath: app, entry: 'git log *' });
    await store.allow({ realPath: app, entry: 'ls' });
    await store.revoke({ realPath: app, entry: 'git log *' });
    await store.revoke({ realPath: app, entry: 'rm -rf x' });

    expect(await store.read(app)).toEqual({ mode: 'ask', allow: ['ls'] });
    expect(await store.read(site)).toEqual({ mode: 'ask', allow: [] });
  });

  it('is read back by a new store on the same folder, as every conversation sees it', async () => {
    await store.allow({ realPath: app, entry: 'git status' });

    const another = new PermissionStore({ root });

    expect(await another.read(app)).toEqual({ mode: 'ask', allow: ['git status'] });
    await another.setMode({ realPath: app, mode: 'allow_all' });
    expect(await store.read(app)).toMatchObject({ mode: 'allow_all' });
  });

  it('loses no change when several are made at once', async () => {
    const entries = Array.from({ length: 12 }, (_, index) => `tool${index} *`);

    await Promise.all(entries.map((entry) => store.allow({ realPath: app, entry })));

    expect((await store.read(app)).allow.toSorted()).toEqual(entries.toSorted());
  });

  it('writes the root beside the permissions, for a person to read', async () => {
    await store.allow({ realPath: app, entry: 'ls' });

    expect(JSON.parse(await readFile(fileOf(app), 'utf8'))).toEqual({
      root: app,
      mode: 'ask',
      allow: ['ls'],
    });
  });

  it.each(['', '*', '* log', 'git  log', ' git', 'a\nb'])(
    'refuses to store %j and leaves the file as it was',
    async (entry) => {
      await store.allow({ realPath: app, entry: 'ls' });

      await expect(store.allow({ realPath: app, entry })).rejects.toThrow();
      expect(await store.read(app)).toEqual({ mode: 'ask', allow: ['ls'] });
    },
  );

  it('stops at a file it cannot read, instead of replacing it', async () => {
    await mkdir(path.dirname(fileOf(app)), { recursive: true });
    await writeFile(fileOf(app), '{ not json');

    await expect(store.read(app)).rejects.toBeInstanceOf(StorageFileError);
    await expect(store.allow({ realPath: app, entry: 'ls' })).rejects.toBeInstanceOf(
      StorageFileError,
    );
    expect(await readFile(fileOf(app), 'utf8')).toBe('{ not json');
  });

  it('stops at a file whose entries are not valid, naming the file', async () => {
    await mkdir(path.dirname(fileOf(app)), { recursive: true });
    await writeFile(fileOf(app), JSON.stringify({ root: app, mode: 'ask', allow: ['*'] }));

    await expect(store.read(app)).rejects.toThrow(fileOf(app));
  });

  it('refuses a file copied to another workspace, which would grant it commands it never had', async () => {
    await store.allow({ realPath: app, entry: 'git push *' });
    await mkdir(path.dirname(fileOf(site)), { recursive: true });
    await writeFile(fileOf(site), await readFile(fileOf(app), 'utf8'));

    await expect(store.read(site)).rejects.toThrow('not this workspace');
    expect(await store.read(app)).toMatchObject({ allow: ['git push *'] });
  });

  it('does not hand out the list it keeps', async () => {
    await store.allow({ realPath: app, entry: 'ls' });

    const first = await store.read(app);

    first.allow.push('rm *');
    expect((await store.read(app)).allow).toEqual(['ls']);
  });
});
