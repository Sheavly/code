import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { workspaceKey } from '@sheavly/storage/config-store/config-store.utils';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { useTempFolders } from '@sheavly/testing/files/temp-folders.fake';
import { setUpProfile } from '../../profiles/testing/profiles.fake.js';
import { testBackend } from '../../testing/backend.fake.js';
import { json, post, put, query } from '../../testing/requests.fake.js';

const folders = useTempFolders({ prefix: 'permission-routes-', names: ['app', 'site'] });

const api = (extra: { remoteSetupAllowed?: boolean } = {}) =>
  testBackend({ home: path.join(folders.base, 'sheavly'), workspace: folders.app, ...extra });

type Api = ReturnType<typeof api>;
const permissionsOf = async (a: Api, workspace: string) =>
  json(await query(a, '/permissions', { workspace }));

describe('reading a folder’s permissions', () => {
  it('starts on ask with nothing allowed, and lists what runs without asking', async () => {
    const a = api();
    const read = await permissionsOf(a, folders.site);

    expect(read).toMatchObject({ mode: 'ask', allow: [] });
    expect(read.builtIn).toEqual(expect.arrayContaining(['ls *', 'git status *', 'pwd']));
    expect(read.workspace).toContain('site');
  });

  it('writes nothing to find out', async () => {
    await permissionsOf(api(), folders.site);

    expect(existsSync(path.join(folders.base, 'sheavly', 'permissions'))).toBe(false);
  });

  it.each([
    ['a relative path', 'relative/folder'],
    ['a folder that does not exist', '/no/such/folder/for/sheavly'],
    ['the filesystem root', '/'],
  ])('refuses %s', async (_, workspace) => {
    expect((await query(api(), '/permissions', { workspace })).status).toBe(422);
  });

  it('refuses a request with no folder', async () => {
    expect((await query(api(), '/permissions', {})).status).toBe(400);
  });
});

describe('changing a folder’s permissions', () => {
  it('sets the mode of one folder and leaves another alone', async () => {
    const a = api();

    expect(
      (await put(a, '/permissions/mode', { workspace: folders.site, mode: 'allow_all' })).status,
    ).toBe(204);

    expect(await permissionsOf(a, folders.site)).toMatchObject({ mode: 'allow_all' });
    expect(await permissionsOf(a, folders.app)).toMatchObject({ mode: 'ask' });
  });

  it('allows a command once, and stops allowing it', async () => {
    const a = api();
    const entry = { workspace: folders.site, entry: 'git log *' };

    expect((await post(a, '/permissions/allow', entry)).status).toBe(204);
    expect((await post(a, '/permissions/allow', entry)).status).toBe(204);
    expect(await permissionsOf(a, folders.site)).toMatchObject({ allow: ['git log *'] });

    expect((await post(a, '/permissions/revoke', entry)).status).toBe(204);
    expect((await post(a, '/permissions/revoke', entry)).status).toBe(204);
    expect(await permissionsOf(a, folders.site)).toMatchObject({ allow: [] });
  });

  it('keeps it where the conversations read it, in the user’s folder and not the repo', async () => {
    const a = api();

    await post(a, '/permissions/allow', { workspace: folders.site, entry: 'ls src' });

    const key = workspaceKey({
      realPath: (await permissionsOf(a, folders.site)).workspace as string,
    });
    const file = path.join(folders.base, 'sheavly', 'permissions', `${key}.json`);

    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      mode: 'ask',
      allow: ['ls src'],
    });
    expect(existsSync(path.join(folders.site, '.sheavly'))).toBe(false);
  });

  it.each([
    ['an empty entry', ''],
    ['an entry that allows every program', '*'],
    ['an entry that starts with *', '* log'],
    ['an entry with a double space', 'git  log'],
    ['an entry with a newline', 'git\nlog'],
  ])('refuses %s, and keeps nothing', async (_, entry) => {
    const a = api();

    expect((await post(a, '/permissions/allow', { workspace: folders.site, entry })).status).toBe(
      400,
    );
    expect(await permissionsOf(a, folders.site)).toMatchObject({ allow: [] });
  });

  it('refuses a mode that does not exist', async () => {
    expect(
      (await put(api(), '/permissions/mode', { workspace: folders.site, mode: 'sandbox' })).status,
    ).toBe(400);
  });

  it('refuses a change to a folder that cannot be worked in, writing nothing', async () => {
    const a = api();

    expect((await post(a, '/permissions/allow', { workspace: '/', entry: 'ls' })).status).toBe(422);
    expect(existsSync(path.join(folders.base, 'sheavly', 'permissions'))).toBe(false);
  });
});

describe('on a backend that listens beyond this machine', () => {
  it('refuses anything that loosens what the agent may run, saying why', async () => {
    const a = api({ remoteSetupAllowed: false });
    const refused = [
      await put(a, '/permissions/mode', { workspace: folders.site, mode: 'allow_all' }),
      await put(a, '/permissions/mode', { workspace: folders.site, mode: 'ask' }),
      await post(a, '/permissions/allow', { workspace: folders.site, entry: 'rm *' }),
    ];

    for (const response of refused) {
      expect(response.status).toBe(403);
      expect(await json(response)).toMatchObject({
        error: {
          code: 'forbidden',
          message: expect.stringContaining('SERVER_ALLOW_REMOTE_SETUP') as string,
        },
      });
    }

    expect(await permissionsOf(a, folders.site)).toMatchObject({ mode: 'ask', allow: [] });
  });

  it('still reads, tightens and revokes, since taking power away is always safe', async () => {
    const local = api();
    const remote = api({ remoteSetupAllowed: false });

    await post(local, '/permissions/allow', { workspace: folders.site, entry: 'git log *' });

    expect((await permissionsOf(remote, folders.site)).allow).toEqual(['git log *']);
    expect(
      (await put(remote, '/permissions/mode', { workspace: folders.site, mode: 'always_ask' }))
        .status,
    ).toBe(204);
    expect(
      (await post(remote, '/permissions/revoke', { workspace: folders.site, entry: 'git log *' }))
        .status,
    ).toBe(204);
    expect(await permissionsOf(remote, folders.site)).toMatchObject({
      mode: 'always_ask',
      allow: [],
    });
  });

  it('allows it all once the operator opted in', async () => {
    const a = api({ remoteSetupAllowed: true });

    expect(
      (await put(a, '/permissions/mode', { workspace: folders.site, mode: 'allow_all' })).status,
    ).toBe(204);
  });
});

describe('a running conversation', () => {
  /** A profile with one model in the user's folder, so a conversation can start. */
  const withProfile = () =>
    setUpProfile({
      home: path.join(folders.base, 'sheavly'),
      models: [
        {
          id: modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a31'),
          name: 'Fast',
          adapter: 'openai',
          definition: { model: 'gpt-fast' },
        },
      ],
    });

  it('reports the mode a route sets from then on, with no restart', async () => {
    await withProfile();

    const a = api();
    const id = await a.conversations.start();

    expect(await a.conversations.details(id)).toMatchObject({ permissionMode: 'ask' });

    await put(a, '/permissions/mode', { workspace: folders.app, mode: 'allow_all' });
    expect(await a.conversations.details(id)).toMatchObject({ permissionMode: 'allow_all' });

    await put(a, '/permissions/mode', { workspace: folders.app, mode: 'always_ask' });
    expect(await a.conversations.details(id)).toMatchObject({ permissionMode: 'always_ask' });

    await a.conversations.closeAll();
  });

  it('is told about a mode set before it started', async () => {
    await withProfile();

    const a = api();

    await put(a, '/permissions/mode', { workspace: folders.app, mode: 'allow_all' });

    const id = await a.conversations.start();

    expect(await a.conversations.details(id)).toMatchObject({ permissionMode: 'allow_all' });
    await a.conversations.closeAll();
  });
});
