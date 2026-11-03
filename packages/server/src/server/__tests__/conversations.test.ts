import { describe, expect, it } from 'vitest';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { reply, testServer } from '../../testing/server.fake.js';
import { readEntries } from '../../client/entries.helper.js';

const calls = (name: string) => () => [
  toolCall({ id: 'c1', name, input: {} }),
  { type: 'done' as const, stopReason: 'tool_use' as const },
];

/** One line per entry, for comparing streams: `kind:type`. */
const kindOf = (entry: StreamEntry) =>
  `${entry.kind}:${entry.kind === 'event' ? entry.event.type : entry.update.type}`;

describe('a conversation over HTTP', () => {
  it('answers each prompt with its entries, in order with no gaps, the second on the first one’s history', async () => {
    const { request, start } = testServer({ hi: [reply('hello'), reply('again')] });
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
    const { request, start } = testServer({ hi: [reply('hello')] });
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
      'event:text_delta',
      'event:turn_end',
      'update:session_idle',
      'event:done',
    ]);
  });

  it('resumes right after the last entry a client got (Last-Event-ID)', async () => {
    const { request, start } = testServer({ hi: [reply('hello')] });
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
    const { request, start } = testServer({ wait: [calls('block')] });
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
    const { request, start } = testServer({ go: [calls('ask'), reply('done')] });
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
    const { request, start } = testServer({ go: [calls('ask'), reply('done')] });
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
    const { conversations, start } = testServer({ go: [calls('ask'), reply('done')] });
    const id = conversationIdSchema.parse(await start());
    const { events } = await conversations.send({ id, prompt: { text: 'go' } });
    const results: string[] = [];

    for await (const event of events) {
      if (event.type === 'tool_result') results.push(event.message.content);
    }

    expect(results[0]).toMatch(/listening/);
  });

  it('describes a conversation, and switches its model only to one it has', async () => {
    const { request, start } = testServer({});
    const id = await start();
    const switchTo = (name: string) =>
      request(`/conversations/${id}/model`, { method: 'PUT', body: { name } });

    expect(await (await request(`/conversations/${id}`)).json()).toMatchObject({
      id,
      workspace: '/work',
      model: { name: 'fast' },
    });
    expect((await switchTo('deep')).status).toBe(204);
    expect(await (await request(`/conversations/${id}`)).json()).toMatchObject({
      model: { name: 'deep', adapter: 'azure' },
    });
    expect(await (await switchTo('huge')).json()).toMatchObject({
      error: { code: 'unknown_model' },
    });
    expect((await switchTo('')).status).toBe(400);
  });

  it('streams a background task starting and ending, under the session that started it', async () => {
    const { request, start, conversations } = testServer({});
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
    const { request, start } = testServer({});
    const id = await start();

    expect((await request(`/conversations/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await (await request(`/conversations/${id}/messages`)).json()).toMatchObject({
      error: { code: 'not_found' },
    });
  });
});
