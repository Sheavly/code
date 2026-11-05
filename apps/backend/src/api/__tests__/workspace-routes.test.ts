import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import { useTempFolders } from '@sheavly/testing/files/temp-folders.fake';
import { testBackend } from '../../testing/backend.fake.js';

const WORK = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';
const HOME = '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71';
const WORK_MODEL = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a31';
const HOME_MODEL = '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b72';
const GHOST = 'c1e8a3d4-7b25-4e69-8f10-2a6d9b4c7e53';

const folders = useTempFolders({ prefix: 'workspace-routes-', names: ['app', 'site'] });

const api = (extra: { remoteSetupAllowed?: boolean } = {}) =>
  testBackend({
    home: path.join(folders.base, 'sheavly'),
    workspace: folders.app,
    fetch: fakeFetch([{ type: 'response.output_text.delta', delta: 'hi' }]).fetch,
    ...extra,
  });

type Api = ReturnType<typeof api>;

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;
const post = (a: Api, path: string, body: unknown) => a.call(path, { method: 'POST', body });
const put = (a: Api, path: string, body: unknown) => a.call(path, { method: 'PUT', body });
const query = (a: Api, path: string, body: unknown) => a.call(path, { method: 'QUERY', body });

/** Two profiles with a model and key each, Work the default. */
async function twoProfiles(a: Api) {
  for (const [id, name, model] of [
    [WORK, 'Work', WORK_MODEL],
    [HOME, 'Home', HOME_MODEL],
  ] as const) {
    await put(a, `/profiles/${id}`, { name });
    await put(a, `/profiles/${id}/models/${model}`, {
      name,
      adapter: 'openai',
      definition: { model: `gpt-${name.toLowerCase()}` },
    });
    await put(a, `/profiles/${id}/credentials/${model}`, { secrets: { apiKey: `key-${name}` } });
  }

  await put(a, '/default-profile', { profile: WORK });
}

describe('binding a folder to a profile', () => {
  it('runs on the default until bound, then on the bound profile, and on the default again once unbound', async () => {
    const a = api();

    await twoProfiles(a);

    const before = await json(await query(a, '/workspace-profiles', { workspace: folders.site }));

    expect(before).toMatchObject({ profile: WORK, bound: false });

    expect(
      (await put(a, '/workspace-profiles', { workspace: folders.site, profile: HOME })).status,
    ).toBe(204);
    expect(
      await json(await query(a, '/workspace-profiles', { workspace: folders.site })),
    ).toMatchObject({
      profile: HOME,
      bound: true,
    });

    expect((await post(a, '/workspace-profiles/unbind', { workspace: folders.site })).status).toBe(
      204,
    );
    expect(
      await json(await query(a, '/workspace-profiles', { workspace: folders.site })),
    ).toMatchObject({
      profile: WORK,
      bound: false,
    });
  });

  it('is what a conversation started without a profile runs on, for that folder only', async () => {
    const a = api();

    await twoProfiles(a);
    await put(a, '/workspace-profiles', { workspace: folders.site, profile: HOME });

    const start = async (workspace: string) => {
      const { id } = (await json(await post(a, '/conversations', { workspace }))) as { id: string };

      return json(await a.call(`/conversations/${id}`));
    };

    expect(await start(folders.site)).toMatchObject({ profile: HOME, model: { id: HOME_MODEL } });
    expect(await start(folders.app)).toMatchObject({ profile: WORK, model: { id: WORK_MODEL } });
    await a.conversations.closeAll();
  });

  it('is shared by the folder however it is spelled, through a symlink or a trailing slash', async () => {
    const a = api();

    await twoProfiles(a);
    await put(a, '/workspace-profiles', { workspace: folders.site, profile: HOME });

    const seen = await query(a, '/workspace-profiles', { workspace: `${folders.site}${path.sep}` });

    expect(await json(seen)).toMatchObject({ profile: HOME, bound: true });
  });

  it('refuses a profile that does not exist, and binds nothing', async () => {
    const a = api();

    await twoProfiles(a);

    const refused = await put(a, '/workspace-profiles', {
      workspace: folders.site,
      profile: GHOST,
    });

    expect(refused.status).toBe(404);
    expect(await json(refused)).toMatchObject({ error: { code: 'not_found' } });
    expect(
      await json(await query(a, '/workspace-profiles', { workspace: folders.site })),
    ).toMatchObject({
      bound: false,
    });
  });

  it('reports a folder bound to a profile that was deleted as running on the default', async () => {
    const a = api();

    await twoProfiles(a);
    await put(a, '/workspace-profiles', { workspace: folders.site, profile: HOME });
    await a.call(`/profiles/${HOME}`, { method: 'DELETE' });

    expect(
      await json(await query(a, '/workspace-profiles', { workspace: folders.site })),
    ).toMatchObject({
      profile: WORK,
      bound: false,
    });
  });

  it('reports no profile at all on a first run', async () => {
    const answer = await json(
      await query(api(), '/workspace-profiles', { workspace: folders.site }),
    );

    expect(answer).toMatchObject({ bound: false });
    expect(answer).not.toHaveProperty('profile');
  });

  it.each([
    ['not absolute', 'relative/path'],
    ['not there', path.join(folders.base, 'missing')],
    ['the top of a file system', path.resolve(path.sep)],
  ])('refuses a folder that is %s, in all three routes', async (_what, workspace) => {
    const a = api();

    await twoProfiles(a);

    const answers = [
      await query(a, '/workspace-profiles', { workspace }),
      await put(a, '/workspace-profiles', { workspace, profile: HOME }),
      await post(a, '/workspace-profiles/unbind', { workspace }),
    ];

    expect(answers.map((response) => response.status)).toEqual([422, 422, 422]);
  });

  it('refuses a malformed body as a bad request', async () => {
    const a = api();

    for (const body of [{}, { workspace: '' }, { workspace: folders.site, profile: 'Home' }]) {
      expect((await put(a, '/workspace-profiles', body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('trusting a folder', () => {
  const trusted = async (a: Api, search?: string) =>
    ((await json(await query(a, '/trusted-workspaces', search ? { search } : {}))).workspaces ??
      []) as { root: string; trustedAt: number; state: string }[];

  async function withHooks(folder: string) {
    await mkdir(path.join(folder, '.sheavly', 'hooks'), { recursive: true });
    await writeFile(path.join(folder, '.sheavly', 'hooks.json'), '{"version":1,"hooks":[]}');
  }

  it('lists nothing at first, then each trusted folder with when and whether it still holds', async () => {
    const a = api();

    expect(await trusted(a)).toEqual([]);

    await withHooks(folders.site);
    expect((await post(a, '/trusted-workspaces', { workspace: folders.site })).status).toBe(204);

    const listed = await trusted(a);

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      state: 'trusted',
      root: expect.stringContaining('site') as string,
    });
  });

  it('is what a conversation in that folder reports as its project trust', async () => {
    const a = api();

    await twoProfiles(a);
    await withHooks(folders.site);

    const trustOf = async () => {
      const { id } = (await json(await post(a, '/conversations', { workspace: folders.site }))) as {
        id: string;
      };

      return (await json(await a.call(`/conversations/${id}`))).projectTrust;
    };

    expect(await trustOf()).toBe('untrusted');

    await post(a, '/trusted-workspaces', { workspace: folders.site });

    expect(await trustOf()).toBe('trusted');
    await a.conversations.closeAll();
  });

  it('says changed once the folder’s .sheavly/ changed, and a new trust makes it trusted again', async () => {
    const a = api();

    await withHooks(folders.site);
    await post(a, '/trusted-workspaces', { workspace: folders.site });
    await writeFile(path.join(folders.site, '.sheavly', 'hooks.json'), '{"version":1,"hooks":[]} ');

    expect((await trusted(a))[0]?.state).toBe('changed');

    await post(a, '/trusted-workspaces', { workspace: folders.site });

    expect((await trusted(a))[0]?.state).toBe('trusted');
  });

  it('searches the paths, ignoring case', async () => {
    const a = api();

    await withHooks(folders.site);
    await withHooks(folders.app);
    await post(a, '/trusted-workspaces', { workspace: folders.site });
    await post(a, '/trusted-workspaces', { workspace: folders.app });

    expect(await trusted(a, 'SITE')).toHaveLength(1);
    expect(await trusted(a, 'nothing like it')).toEqual([]);
    expect(await trusted(a)).toHaveLength(2);
    expect((await query(a, '/trusted-workspaces', { search: '' })).status).toBe(400);
  });

  it('revokes one, and also one whose folder has since been deleted', async () => {
    const a = api();

    await withHooks(folders.site);
    await post(a, '/trusted-workspaces', { workspace: folders.site });

    const [entry] = await trusted(a);
    const realRoot = entry?.root ?? '';

    expect((await post(a, '/trusted-workspaces/revoke', { workspace: folders.site })).status).toBe(
      204,
    );
    expect(await trusted(a)).toEqual([]);

    // Trusted again, then the folder is deleted: it is listed as gone and can still be cleared.
    await post(a, '/trusted-workspaces', { workspace: folders.site });
    await import('node:fs/promises').then(({ rm }) => rm(folders.site, { recursive: true }));

    expect((await trusted(a))[0]).toMatchObject({ root: realRoot, state: 'gone' });
    expect((await post(a, '/trusted-workspaces/revoke', { workspace: realRoot })).status).toBe(204);
    expect(await trusted(a)).toEqual([]);
  });

  it('revoking what was never trusted is fine', async () => {
    const a = api();

    expect((await post(a, '/trusted-workspaces/revoke', { workspace: folders.site })).status).toBe(
      204,
    );
  });

  it('refuses to trust a folder that cannot be a workspace, and trusts nothing', async () => {
    const a = api();

    for (const workspace of [
      'relative',
      path.join(folders.base, 'missing'),
      path.resolve(path.sep),
    ]) {
      expect((await post(a, '/trusted-workspaces', { workspace })).status, workspace).toBe(422);
    }

    expect(await trusted(a)).toEqual([]);
  });

  it('refuses to revoke a path that is not absolute', async () => {
    expect(
      (await post(api(), '/trusted-workspaces/revoke', { workspace: 'relative' })).status,
    ).toBe(422);
  });
});

describe('a backend that listens beyond this machine', () => {
  it('grants no trust, saying why, but still lists, revokes and binds', async () => {
    const a = api({ remoteSetupAllowed: false });

    await mkdir(path.join(folders.site, '.sheavly'), { recursive: true });

    const refused = await post(a, '/trusted-workspaces', { workspace: folders.site });

    expect(refused.status).toBe(403);
    expect(await json(refused)).toMatchObject({ error: { code: 'forbidden' } });
    expect(await json(await query(a, '/trusted-workspaces', {}))).toEqual({ workspaces: [] });
    expect((await post(a, '/trusted-workspaces/revoke', { workspace: folders.site })).status).toBe(
      204,
    );
  });

  it('can still revoke a trust that was granted before, since taking trust away is always safe', async () => {
    const local = api();

    await mkdir(path.join(folders.site, '.sheavly'), { recursive: true });
    await post(local, '/trusted-workspaces', { workspace: folders.site });

    // The same trust file, now served by a remote-bound backend.
    const remote = api({ remoteSetupAllowed: false });
    const listed = (await json(await query(remote, '/trusted-workspaces', {})))
      .workspaces as unknown[];

    expect(listed).toHaveLength(1);
    expect(
      (await post(remote, '/trusted-workspaces/revoke', { workspace: folders.site })).status,
    ).toBe(204);
    expect((await json(await query(remote, '/trusted-workspaces', {}))).workspaces).toEqual([]);
  });
});
