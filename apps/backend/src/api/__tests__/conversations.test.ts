import { describe, expect, it } from 'vitest';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { readEntries } from '@sheavly/client/client/entries.helper';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { DEEP_ID, FAST_ID } from '@sheavly/host/testing/run.fake';
import { reply, testApi } from '../../testing/api.fake.js';

/** A well-formed id that no conversation's models have. */
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const calls = (name: string) => () => [
  toolCall({ id: 'c1', name, input: {} }),
  { type: 'done' as const, stopReason: 'tool_use' as const },
];

/** One line per entry, for comparing streams: `kind:type`. */
const kindOf = (entry: StreamEntry) =>
  `${entry.kind}:${entry.kind === 'event' ? entry.event.type : entry.update.type}`;

describe('a conversation over HTTP', () => {
  it('answers each prompt with its entries, in order with no gaps, the second on the first one’s history', async () => {
    const { request, start } = testApi({ hi: [reply('hello'), reply('again')] });
    const id = await start();
    const prompt = async (text: string) => {
      const response = await request(`/conversations/${id}/prompts`, {
        method: 'POST',
        body: { text },
      });

      expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);

      const frames = [];

      for await (const frame of readEntries(response.body)) frames.push(frame);

      return frames;
    };

    const first = await prompt('hi');
    const second = await prompt('and now?');

    for (const frames of [first, second]) {
      const seqs = frames.map(({ entry }) => entry.seq);

      expect(frames.map(({ id: frameId }) => frameId)).toEqual(seqs.map(String));
      expect(seqs).toEqual(seqs.map((_, index) => (seqs[0] ?? 0) + index));
      expect(frames.at(-1)?.entry).toMatchObject({ kind: 'event', event: { type: 'done' } });
    }

    expect(kindOf(second[0]!.entry)).toBe('update:session_resumed');
    // The session went idle before the first's done, so the second follows that done at once.
    expect(second[0]!.entry.seq).toBe(first.at(-1)!.entry.seq + 1);

    const messages = (await (await request(`/conversations/${id}/messages`)).json()) as {
      messages: { role: string; content: string }[];
    };

    expect(messages.messages.map((m) => m.content)).toEqual(['hi', 'hello', 'and now?', 'again']);
  });

  it('streams the whole conversation to a client that joins late, from the start with replay', async () => {
    const { request, start } = testApi({ hi: [reply('hello')] });
    const id = await start();

    for await (const _frame of readEntries(
      (await request(`/conversations/${id}/prompts`, { method: 'POST', body: { text: 'hi' } }))
        .body,
    ));

    const stream = await request(`/conversations/${id}/stream`, {
      method: 'QUERY',
      body: { replay: true },
    });
    const kinds: string[] = [];

    // The stream stays open for later prompts: read until the replayed prompt's done.
    for await (const { entry } of readEntries(stream.body)) {
      kinds.push(kindOf(entry));
      if (kinds.includes('event:done')) break;
    }

    expect(kinds).toEqual([
      'update:session_started',
      // The model the conversation began on is part of its history.
      'update:session_model',
      'event:text_delta',
      'event:usage',
      'event:turn_end',
      'update:session_idle',
      'event:done',
    ]);
  });

  it('resumes right after the last entry a client got (Last-Event-ID)', async () => {
    const { request, start } = testApi({ hi: [reply('hello')] });
    const id = await start();
    const prompted = await request(`/conversations/${id}/prompts`, {
      method: 'POST',
      body: { text: 'hi' },
    });
    const seqs: number[] = [];

    for await (const { entry } of readEntries(prompted.body)) seqs.push(entry.seq);

    const resumed = await request(`/conversations/${id}/stream`, {
      method: 'QUERY',
      body: {},
      headers: { 'last-event-id': String(seqs[1]) },
    });

    for await (const { entry } of readEntries(resumed.body)) {
      expect(entry.seq).toBe((seqs[1] ?? 0) + 1);
      break;
    }
  });

  it('stops a running prompt, keeping history valid, and refuses another while one runs', async () => {
    const { request, start } = testApi({ wait: [calls('block')] });
    const id = await start();
    const prompted = await request(`/conversations/${id}/prompts`, {
      method: 'POST',
      body: { text: 'wait' },
    });
    const kinds: string[] = [];

    for await (const { entry } of readEntries(prompted.body)) {
      kinds.push(kindOf(entry));

      if (entry.kind === 'event' && entry.event.type === 'tool_call_started') {
        const second = await request(`/conversations/${id}/prompts`, {
          method: 'POST',
          body: { text: 'too soon' },
        });

        expect(second.status).toBe(409);
        expect(await second.json()).toMatchObject({ error: { code: 'session_running' } });
        expect((await request(`/conversations/${id}/stop`, { method: 'POST' })).status).toBe(204);
      }
    }

    expect(kinds.at(-1)).toBe('event:done');

    const messages = (await (await request(`/conversations/${id}/messages`)).json()) as {
      messages: { role: string }[];
    };

    expect(messages.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('sends an approval to a client that answers them, and honours its answer', async () => {
    const { request, start } = testApi({ go: [calls('ask'), reply('done')] });
    const id = await start();
    const stream = await request(`/conversations/${id}/stream`, {
      method: 'QUERY',
      body: { approvals: true },
    });

    await request(`/conversations/${id}/prompts`, { method: 'POST', body: { text: 'go' } });
    let result: unknown;

    for await (const { entry } of readEntries(stream.body)) {
      if (entry.kind === 'approval' && entry.update.type === 'approval_requested') {
        const answered = await request(
          `/conversations/${id}/approvals/${entry.update.request.id}`,
          { method: 'POST', body: { response: { decision: 'skip' } } },
        );

        expect(answered.status).toBe(204);
      }

      if (entry.kind === 'event' && entry.event.type === 'tool_result') {
        result = entry.event.message;
      }

      if (entry.kind === 'event' && entry.event.type === 'done') break;
    }

    expect(result).toMatchObject({ role: 'tool', content: 'skip' });
  });

  it('refuses an approval at once when only a prompt’s own response listens', async () => {
    const { request, start } = testApi({ go: [calls('ask'), reply('done')] });
    const id = await start();
    const prompted = await request(`/conversations/${id}/prompts`, {
      method: 'POST',
      body: { text: 'go' },
    });
    const results: string[] = [];

    for await (const { entry } of readEntries(prompted.body)) {
      if (entry.kind === 'event' && entry.event.type === 'tool_result') {
        results.push(entry.event.message.content);
      }
    }

    expect(results[0]).toMatch(/listening/);
  });

  it('refuses an approval when no client is listening, as a headless run does', async () => {
    const { conversations, start } = testApi({ go: [calls('ask'), reply('done')] });
    const id = conversationIdSchema.parse(await start());
    const { events } = await conversations.send({ id, prompt: { text: 'go' } });
    const results: string[] = [];

    for await (const event of events) {
      if (event.type === 'tool_result') results.push(event.message.content);
    }

    expect(results[0]).toMatch(/listening/);
  });

  it('describes a conversation, and switches its model by id, only to one it has', async () => {
    const { request, start } = testApi({});
    const id = await start();
    const switchTo = (body: object) =>
      request(`/conversations/${id}/model`, { method: 'PUT', body });

    expect(await (await request(`/conversations/${id}`)).json()).toMatchObject({
      id,
      workspace: '/work',
      model: { id: FAST_ID, name: 'Astra' },
    });
    expect((await switchTo({ id: DEEP_ID })).status).toBe(204);
    expect(await (await request(`/conversations/${id}`)).json()).toMatchObject({
      model: { id: DEEP_ID, name: 'Astra', adapter: 'azure-openai' },
    });
    // A well-formed id nobody has: the backend's refusal.
    expect(await (await switchTo({ id: UNKNOWN_ID })).json()).toMatchObject({
      error: { code: 'unknown_model' },
    });

    // Not an id at all: a name (both models are called "Astra"), nothing, or a wrong shape.
    for (const body of [{ name: 'Astra' }, {}, { id: 'Astra' }, { id: DEEP_ID.toUpperCase() }]) {
      expect((await switchTo(body)).status, JSON.stringify(body)).toBe(400);
    }

    // The model in use is still the one the last good switch chose.
    expect(await (await request(`/conversations/${id}`)).json()).toMatchObject({
      model: { id: DEEP_ID },
    });
  });

  it('answers a conversation whose storage failed with storage_failed, not a prompt run', async () => {
    const store = new MemoryConversationStore();
    const { request, start, conversations } = testApi({ hi: [reply('hello')] }, store);
    const id = conversationIdSchema.parse(await start());
    const prompt = () =>
      request(`/conversations/${id}/prompts`, { method: 'POST', body: { text: 'hi' } });

    await (await prompt()).text();
    await conversations.get(id).harness.sessions.flushStore();
    store.failWith(new Error('ENOSPC'));
    await (await prompt()).text();
    await conversations.get(id).harness.sessions.flushStore();

    const refused = await prompt();

    expect(refused.status).toBe(507);
    expect(await refused.json()).toMatchObject({ error: { code: 'storage_failed' } });
  });

  it('streams a background task starting and ending, under the session that started it', async () => {
    const { request, start, conversations } = testApi({});
    const id = conversationIdSchema.parse(await start());
    const { harness } = conversations.get(id);
    const stream = await request(`/conversations/${id}/stream`, { method: 'QUERY', body: {} });

    harness.tasks.start({
      command: 'npm test',
      description: 'Tests',
      sessionId: harness.mainSession.id,
      run: async () => ({ exitCode: 0 }),
    });

    const seen: string[] = [];

    for await (const { entry } of readEntries(stream.body)) {
      if (entry.kind === 'task') seen.push(`${entry.sessionId}:${entry.update.type}`);
      if (seen.length === 2) break;
    }

    expect(seen).toEqual([
      `${harness.mainSession.id}:task_started`,
      `${harness.mainSession.id}:task_ended`,
    ]);
  });

  it('closes a conversation: it is gone after', async () => {
    const { request, start } = testApi({});
    const id = await start();

    expect((await request(`/conversations/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await (await request(`/conversations/${id}/messages`)).json()).toMatchObject({
      error: { code: 'not_found' },
    });
  });
});

describe('kept conversations over HTTP', () => {
  /** Starts a conversation that has a prompt in it, so it has a title and a history, then closes it. */
  async function kept(api: ReturnType<typeof testApi>) {
    const id = await api.start();
    const response = await api.request(`/conversations/${id}/prompts`, {
      method: 'POST',
      body: { text: 'hi' },
    });

    for await (const _frame of readEntries(response.body));
    await api.conversations.close(conversationIdSchema.parse(id));

    return id;
  }

  const query = (api: ReturnType<typeof testApi>, body: unknown = {}) =>
    api.request('/stored-conversations', { method: 'QUERY', body });

  it('lists the kept conversations, and searches them by title', async () => {
    const api = testApi({ hi: [reply('hello')] }, new MemoryConversationStore());
    const id = await kept(api);

    const all = await query(api);

    expect(all.status).toBe(200);
    expect(await all.json()).toMatchObject({ conversations: [{ id, status: 'closed' }] });

    // The title is the conversation's ("Chat"): a search for it finds it, any other does not.
    const found = (await (await query(api, { search: 'CHAT' })).json()) as { conversations: [] };
    const missed = (await (await query(api, { search: 'nothing like it' })).json()) as {
      conversations: [];
    };

    expect(found.conversations).toHaveLength(1);
    expect(missed.conversations).toEqual([]);
  });

  it('refuses an empty search as bad_request, not as "match everything"', async () => {
    const api = testApi({}, new MemoryConversationStore());
    const response = await query(api, { search: '' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('lists nothing when the host keeps nothing', async () => {
    const api = testApi({});

    expect(await (await query(api)).json()).toEqual({ conversations: [] });
  });

  it('reopens a kept conversation under its own id, with its history', async () => {
    const api = testApi({ hi: [reply('hello')] }, new MemoryConversationStore());
    const id = await kept(api);

    expect((await api.request(`/conversations/${id}/messages`)).status).toBe(404);

    const reopened = await api.request(`/stored-conversations/${id}/reopen`, { method: 'POST' });

    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toEqual({ id });
    expect(await (await api.request(`/conversations/${id}/messages`)).json()).toMatchObject({
      messages: [{ role: 'user' }, { role: 'assistant' }],
    });
  });

  it('answers reopening what is not kept, or is not an id, as not_found', async () => {
    const api = testApi({}, new MemoryConversationStore());

    for (const bad of [UNKNOWN_ID, 'nope', '..']) {
      const response = await api.request(`/stored-conversations/${bad}/reopen`, {
        method: 'POST',
      });

      expect(response.status, bad).toBe(404);
      expect(await response.json(), bad).toMatchObject({ error: { code: 'not_found' } });
    }
  });
});
