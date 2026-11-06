import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '@sheavly/testing/fetch/fake-fetch.fake';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { useTempFolders } from '@sheavly/testing/files/temp-folders.fake';
import { testBackend } from '../../testing/backend.fake.js';

const WORK = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';
const HOME = '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71';
const WORK_MODEL = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a31';
const HOME_MODEL = '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b72';
const UNKNOWN_PROFILE = 'c1e8a3d4-7b25-4e69-8f10-2a6d9b4c7e53';

const folders = useTempFolders({ prefix: 'start-routes-', names: ['app', 'site'] });

/** The real backend over a temp home, called through its HTTP app as a client does. */
const api = () =>
  testBackend({
    home: path.join(folders.base, 'sheavly'),
    workspace: folders.app,
    fetch: fakeFetch([{ type: 'response.output_text.delta', delta: 'hi' }]).fetch,
  });

/** Two profiles, each with a model and a key, made through the routes. */
async function setUp(call: ReturnType<typeof api>['call']) {
  for (const [id, name, model] of [
    [WORK, 'Work', WORK_MODEL],
    [HOME, 'Home', HOME_MODEL],
  ] as const) {
    await call(`/profiles/${id}`, { method: 'PUT', body: { name } });
    await call(`/profiles/${id}/models/${model}`, {
      method: 'PUT',
      body: { name, adapter: 'openai', definition: { model: `gpt-${name.toLowerCase()}` } },
    });
    await call(`/profiles/${id}/credentials/${model}`, {
      method: 'PUT',
      body: { secrets: { apiKey: `key-${name}` } },
    });
  }

  await call('/default-profile', { method: 'PUT', body: { profile: WORK } });
}

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;

describe('POST /conversations with a workspace and a profile', () => {
  it('starts on the folder and profile it names, and says so in the details', async () => {
    const { call, conversations } = api();

    await setUp(call);

    const started = await call('/conversations', {
      method: 'POST',
      body: { workspace: folders.site, profile: HOME },
    });

    expect(started.status).toBe(201);

    const { id } = (await json(started)) as { id: string };

    expect(await json(await call(`/conversations/${id}`))).toMatchObject({
      profile: HOME,
      workspace: expect.stringContaining('site') as string,
      model: { id: HOME_MODEL },
    });
    await conversations.closeAll();
  });

  it('starts on the backend’s own folder and the default profile when it names neither', async () => {
    const { call, conversations } = api();

    await setUp(call);

    const { id } = (await json(await call('/conversations', { method: 'POST', body: {} }))) as {
      id: string;
    };

    expect(await json(await call(`/conversations/${id}`))).toMatchObject({
      profile: WORK,
      workspace: expect.stringContaining('app') as string,
    });
    await conversations.closeAll();
  });

  it('answers a folder that cannot be used, or a profile that is not there, as a refusal and starts nothing', async () => {
    const { call, conversations } = api();

    await setUp(call);

    for (const body of [
      { workspace: path.join(folders.base, 'nope') },
      { workspace: 'relative' },
      { workspace: path.resolve(path.sep) },
      { profile: UNKNOWN_PROFILE },
    ]) {
      const response = await call('/conversations', { method: 'POST', body });

      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(await json(response)).toMatchObject({ error: { code: 'bad_request' } });
    }

    expect(conversations.list()).toEqual([]);
  });

  it('refuses a profile that is not an id, and an empty folder, as a bad request', async () => {
    const { call } = api();

    await setUp(call);

    for (const body of [{ profile: 'Work' }, { workspace: '' }, { workspace: 5 }]) {
      expect(
        (await call('/conversations', { method: 'POST', body })).status,
        JSON.stringify(body),
      ).toBe(400);
    }
  });
});

describe('the client, over the same routes', () => {
  it('starts on a folder and profile, reads them back, and finds the conversation in the stored list', async () => {
    const { client, conversations, call } = api();

    await setUp(call);

    const { id } = await client.call('startConversation', {
      body: { workspace: folders.site, profile: profileIdSchema.parse(HOME) },
    });
    const details = await client.call('getConversation', { id });

    // Ids keep their brands through the client: the answer is parsed with the route's schema.
    expect(details).toMatchObject({ id, profile: HOME, model: { id: HOME_MODEL } });
    expect(details.workspace).toContain('site');

    await (
      await call(`/conversations/${id}/prompts`, { method: 'POST', body: { text: 'hi' } })
    ).text();
    await conversations.closeAll();

    const { conversations: kept } = await client.call('queryStoredConversations', {
      body: { profile: profileIdSchema.parse(HOME) },
    });

    expect(kept.map((each) => each.id)).toEqual([id]);
    expect(kept[0]).toMatchObject({ profile: HOME, workspace: details.workspace });
  });

  it('is refused with the backend’s code when the folder cannot be used', async () => {
    const { client, call } = api();

    await setUp(call);

    await expect(
      client.call('startConversation', { body: { workspace: path.join(folders.base, 'nope') } }),
    ).rejects.toMatchObject({ name: 'RefusedError', status: 422, code: 'bad_request' });
  });
});

describe('QUERY /stored-conversations across folders and profiles', () => {
  const stored = async (call: ReturnType<typeof api>['call'], body: unknown) =>
    ((await json(await call('/stored-conversations', { method: 'QUERY', body }))).conversations ??
      []) as { id: string; workspace: string; profile: string }[];

  it('lists every folder’s and profile’s, tagged with where each belongs, and filters by either', async () => {
    const { call, conversations } = api();

    await setUp(call);

    const prompt = async (body: unknown) => {
      const { id } = (await json(await call('/conversations', { method: 'POST', body }))) as {
        id: string;
      };

      await (
        await call(`/conversations/${id}/prompts`, { method: 'POST', body: { text: 'hi' } })
      ).text();

      return id;
    };
    const inApp = await prompt({});
    const inSite = await prompt({ workspace: folders.site, profile: HOME });

    await conversations.closeAll();

    // The route hands its filters to the host (what the host does with them is its own test).
    const onHome = await stored(call, { profile: HOME });
    const siteReal = onHome[0]?.workspace;

    expect(onHome.map((each) => each.id)).toEqual([inSite]);
    expect(onHome[0]).toMatchObject({
      profile: HOME,
      workspace: expect.stringContaining('site') as string,
    });
    expect((await stored(call, { workspace: siteReal })).map((each) => each.id)).toEqual([inSite]);
    expect(await stored(call, { workspace: siteReal, profile: WORK })).toEqual([]);
    expect((await stored(call, {})).map((each) => each.id)).toContain(inApp);
  });

  it('refuses a profile filter that is not an id', async () => {
    const { call } = api();

    expect(
      (await call('/stored-conversations', { method: 'QUERY', body: { profile: 'Work' } })).status,
    ).toBe(400);
  });
});
