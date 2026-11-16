import { describe, expect, it } from 'vitest';
import { readEntries } from '@sheavly/client/client/entries.helper';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { testApi } from '../../testing/api.fake.js';
import { SSE_QUEUE_LIMIT } from '../api.constants.js';

const OVER = 200;

describe('a stream whose consumer is too slow', () => {
  it('is cut at the queue bound, and the client resumes after the last entry it got, losing none', async () => {
    // With a store, as the real backend always has: it holds what the memory tail no longer does.
    const { request, start, conversations } = testApi({}, new MemoryConversationStore());
    const id = await start();
    const { sessions, mainSession } = conversations.get(conversationIdSchema.parse(id)).harness;
    const stream = await request(`/conversations/${id}/stream`, { method: 'QUERY', body: {} });
    const made: number[] = [];

    sessions.subscribeEntries((entry) => made.push(entry.seq));

    // Nothing reads the stream while these are made, so they pile up behind it.
    for (let i = 0; i < SSE_QUEUE_LIMIT + OVER; i++) {
      sessions.publish({
        sessionId: mainSession.id,
        event: { seq: i, type: 'text_delta', text: 'x' },
      });
    }

    const got: number[] = [];

    for await (const { entry } of readEntries(stream.body)) got.push(entry.seq);

    // It ended on its own, short of the last entry: the consumer was cut off, not served.
    expect(got.length).toBeLessThan(made.length);

    const resumed = await request(`/conversations/${id}/stream`, {
      method: 'QUERY',
      body: {},
      headers: { 'last-event-id': String(got.at(-1) ?? (made[0] ?? 0) - 1) },
    });
    const rest: number[] = [];

    for await (const { entry } of readEntries(resumed.body)) {
      rest.push(entry.seq);
      if (entry.seq === made.at(-1)) break;
    }

    // Each entry once, in order, with no gap between what it got and what it resumed with.
    expect([...got, ...rest]).toEqual(made);
  });
});
