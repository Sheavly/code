import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerClient } from '../../client/client.helper.js';
import { reply, testServer } from '../../testing/server.fake.js';
import { readEntries } from '../../client/entries.helper.js';
import { TEST_TOKEN } from '../../testing/testing.constants.js';

describe('the server’s guards', () => {
  it('refuses a request without the token, or with a wrong one, before any route runs', async () => {
    const { app, conversations } = testServer({});

    for (const authorization of [
      undefined,
      'Bearer wrong',
      'Basic dGVzdA==',
      `Bearer ${TEST_TOKEN}x`,
    ]) {
      const response = await app.request('/conversations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization !== undefined && { authorization }),
        },
        body: '{}',
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: 'unauthorized', message: 'A valid bearer token is required' },
      });
    }

    await conversations.closeAll();
  });

  it('answers a malformed body as bad_request, and an unknown conversation as not_found', async () => {
    const { request, start } = testServer({});
    const id = await start();

    const both = await request(`/conversations/${id}/prompts`, {
      method: 'POST',
      body: { text: 'a', parts: [{ type: 'text', text: 'a' }] },
    });

    expect(both.status).toBe(400);
    expect(await both.json()).toMatchObject({ error: { code: 'bad_request' } });

    const missing = await request('/conversations/nope/messages');

    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'not_found' } });
    expect((await request('/nowhere')).status).toBe(404);
  });

  it('refuses a picked skill no one has with unknown_skill, before the prompt starts', async () => {
    const { request, start } = testServer({});
    const id = await start();
    const response = await request(`/conversations/${id}/prompts`, {
      method: 'POST',
      body: { parts: [{ type: 'skill', name: 'nope' }] },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'unknown_skill' } });
    expect(await (await request(`/conversations/${id}/skills`)).json()).toEqual({
      skills: [{ name: 'review', description: 'Reviews.', manualOnly: false, scope: 'project' }],
    });
  });

  it('answers an approval no one is waiting for with unknown_approval', async () => {
    const { request, start } = testServer({});
    const id = await start();
    const response = await request(`/conversations/${id}/approvals/a9`, {
      method: 'POST',
      body: { response: { decision: 'approve' } },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'unknown_approval' } });
  });
});

describe('over real HTTP, with the typed client', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  /** Listens on a free port on 127.0.0.1, as an app would. */
  async function listen() {
    const { app, conversations } = testServer({ hi: [reply('hello')] });
    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const started = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () =>
        resolve(started),
      );
    });

    close = async () => {
      await conversations.closeAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    };

    return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }

  it('starts a conversation, streams a prompt over QUERY and SSE, and reads the history', async () => {
    const url = await listen();
    const client = createServerClient({ url, token: TEST_TOKEN });
    const started = await client.conversations.$post({ json: {} });
    const { id } = await started.json();

    // The stream is opened first: it sees the prompt's entries as they happen, over the socket.
    const stream = await client.conversations[':id'].stream.$query({ param: { id }, json: {} });
    const prompted = await client.conversations[':id'].prompts.$post({
      param: { id },
      json: { text: 'hi' },
    });
    const answered: string[] = [];
    const streamed: string[] = [];

    for await (const { entry } of readEntries(prompted.body)) {
      if (entry.kind === 'event' && entry.event.type === 'text_delta') {
        answered.push(entry.event.text);
      }
    }

    for await (const { entry } of readEntries(stream.body)) {
      streamed.push(entry.kind === 'event' ? entry.event.type : entry.update.type);
      if (streamed.includes('done')) break;
    }

    const history = await (
      await client.conversations[':id'].messages.$get({ param: { id } })
    ).json();

    expect(started.status).toBe(201);
    expect(answered).toEqual(['hello']);
    expect(streamed).toContain('text_delta');
    expect(history.messages.map((message) => message.content)).toEqual(['hi', 'hello']);
  });

  it('lets a second UI find a conversation another started, and follow it', async () => {
    const url = await listen();
    const editor = createServerClient({ url, token: TEST_TOKEN });
    const agentWindow = createServerClient({ url, token: TEST_TOKEN });
    const { id } = await (await editor.conversations.$post({ json: {} })).json();
    const listed = await (await agentWindow.conversations.$get()).json();
    const found = listed.conversations.find((conversation) => conversation.id === id);

    if (!found) throw new Error('the agent window doesn’t see the editor’s conversation');
    expect(found).toMatchObject({ id, running: false });

    // The agent window follows the main session; the editor sends the prompt.
    const stream = await agentWindow.conversations[':id'].stream.$query({
      param: { id },
      json: { session: found.session },
    });

    for await (const _frame of readEntries(
      (await editor.conversations[':id'].prompts.$post({ param: { id }, json: { text: 'hi' } }))
        .body,
    ));

    const seen: string[] = [];

    for await (const { entry } of readEntries(stream.body)) {
      if (entry.kind === 'event' && entry.event.type === 'text_delta') seen.push(entry.event.text);
      if (entry.kind === 'event' && entry.event.type === 'done') break;
    }

    expect(seen).toEqual(['hello']);
  });

  it('refuses a request without the token over the network too', async () => {
    const url = await listen();
    const response = await fetch(`${url}/conversations`, { method: 'POST', body: '{}' });

    expect(response.status).toBe(401);
  });
});
