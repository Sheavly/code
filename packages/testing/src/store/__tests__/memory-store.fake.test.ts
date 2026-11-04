import { describe, expect, it } from 'vitest';
import { StoreError } from '@sheavly/core/errors/store.errors';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { MemoryConversationStore } from '../memory-store.fake.js';

const id = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
const entry = (seq: number): StreamEntry => ({
  seq,
  at: 0,
  sessionId: sessionIdSchema.parse('main'),
  kind: 'event',
  event: { seq, type: 'text_delta', text: `t${String(seq)}` },
});
const stored = (conversationId: typeof id, startedAt: number) => ({
  id: conversationId,
  title: 'Chat',
  modelId: modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30'),
  status: 'open' as const,
  startedAt,
  updatedAt: startedAt,
});

async function readAll(params: { store: MemoryConversationStore; from?: number }) {
  const entries: StreamEntry[] = [];

  for await (const each of params.store.entries(id).read(params.from)) entries.push(each);

  return entries;
}

describe('MemoryConversationStore', () => {
  it('reads back the entries it was given, from any seq, as copies', async () => {
    const store = new MemoryConversationStore();

    for (const seq of [0, 1, 2]) await store.entries(id).append(entry(seq));

    expect((await readAll({ store })).map((e) => e.seq)).toEqual([0, 1, 2]);
    expect((await readAll({ store, from: 2 })).map((e) => e.seq)).toEqual([2]);
    expect(await readAll({ store: new MemoryConversationStore() })).toEqual([]);
  });

  it('refuses an entry that is not the next one, so a lost write cannot hide', async () => {
    const store = new MemoryConversationStore();

    await store.entries(id).append(entry(0));

    for (const seq of [0, 2]) {
      await expect(store.entries(id).append(entry(seq))).rejects.toMatchObject({
        name: 'StoreError',
        reason: 'out_of_order',
      });
    }

    expect(await readAll({ store })).toHaveLength(1);
  });

  it('lists the index oldest first, and deletes a conversation with its entries', async () => {
    const store = new MemoryConversationStore();
    const other = conversationIdSchema.parse('00000000-0000-4000-8000-000000000002');

    await store.writeIndex(stored(other, 20));
    await store.writeIndex(stored(id, 10));
    await store.entries(id).append(entry(0));

    expect((await store.list()).map((c) => c.id)).toEqual([id, other]);

    await store.writeMessages({ id, messages: [{ role: 'user', content: 'hi' }] });
    await store.delete(id);
    await store.delete(id);

    expect((await store.list()).map((c) => c.id)).toEqual([other]);
    expect(await readAll({ store })).toEqual([]);
    expect(await store.readMessages(id)).toEqual([]);
  });

  it('keeps the history it was given whole, and hands out copies', async () => {
    const store = new MemoryConversationStore();
    const first: Message = { role: 'user', content: 'hi', at: 1 };
    const messages: Message[] = [
      first,
      { role: 'assistant', content: 'hello', toolCalls: [], at: 2 },
    ];

    expect(await store.readMessages(id)).toEqual([]);
    await store.writeMessages({ id, messages });

    const read = await store.readMessages(id);

    expect(read).toEqual(messages);
    read.pop();
    expect(await store.readMessages(id)).toHaveLength(2);

    await store.writeMessages({ id, messages: [first] });
    expect(await store.readMessages(id)).toHaveLength(1);
  });

  it('fails every write while told to, as a full disk does, then mends', async () => {
    const store = new MemoryConversationStore();
    const disk = new Error('ENOSPC');

    store.failWith(disk);

    for (const write of [
      () => store.entries(id).append(entry(0)),
      () => store.writeIndex(stored(id, 1)),
      () => store.writeMessages({ id, messages: [] }),
      () => store.delete(id),
    ]) {
      await expect(write()).rejects.toBeInstanceOf(StoreError);
      await expect(write()).rejects.toMatchObject({ reason: 'failed', cause: disk });
    }

    store.failWith(undefined);
    await store.entries(id).append(entry(0));

    expect(await readAll({ store })).toHaveLength(1);
  });
});
