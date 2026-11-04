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
    await store.writeAgentMessages({
      id,
      session: sessionIdSchema.parse('reader'),
      messages: [{ role: 'user', content: 'read it' }],
    });
    await store.delete(id);
    await store.delete(id);

    expect((await store.list()).map((c) => c.id)).toEqual([other]);
    expect(await readAll({ store })).toEqual([]);
    expect(await store.readMessages(id)).toEqual([]);
    expect(await store.readAgentMessages({ id, session: sessionIdSchema.parse('reader') })).toEqual(
      [],
    );
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

  it('keeps each sub-agent’s history apart: from the conversation’s, from other agents’, and from other conversations’', async () => {
    const store = new MemoryConversationStore();
    const other = conversationIdSchema.parse('00000000-0000-4000-8000-000000000002');
    const reader = sessionIdSchema.parse('reader');
    const writer = sessionIdSchema.parse('writer');
    const read: Message[] = [{ role: 'user', content: 'read it', at: 1 }];
    const wrote: Message[] = [{ role: 'user', content: 'write it', at: 2 }];

    expect(await store.readAgentMessages({ id, session: reader })).toEqual([]);

    await store.writeMessages({ id, messages: [{ role: 'user', content: 'main' }] });
    await store.writeAgentMessages({ id, session: reader, messages: read });
    await store.writeAgentMessages({ id, session: writer, messages: wrote });
    await store.writeAgentMessages({ id: other, session: reader, messages: wrote });

    expect(await store.readAgentMessages({ id, session: reader })).toEqual(read);
    expect(await store.readAgentMessages({ id, session: writer })).toEqual(wrote);
    expect(await store.readAgentMessages({ id: other, session: reader })).toEqual(wrote);
    expect(await store.readMessages(id)).toEqual([{ role: 'user', content: 'main' }]);
    expect(await store.readMessages(other)).toEqual([]);
  });

  it('replaces a sub-agent’s history whole, and hands out copies of it', async () => {
    const store = new MemoryConversationStore();
    const session = sessionIdSchema.parse('reader');
    const messages: Message[] = [
      { role: 'user', content: 'one', at: 1 },
      { role: 'assistant', content: 'two', toolCalls: [], at: 2 },
    ];

    await store.writeAgentMessages({ id, session, messages });

    const copy = await store.readAgentMessages({ id, session });

    copy.pop();
    messages.pop();
    expect(await store.readAgentMessages({ id, session })).toHaveLength(2);

    await store.writeAgentMessages({ id, session, messages: [{ role: 'user', content: 'again' }] });
    expect(await store.readAgentMessages({ id, session })).toEqual([
      { role: 'user', content: 'again' },
    ]);
  });

  it('fails every write while told to, as a full disk does, then mends', async () => {
    const store = new MemoryConversationStore();
    const disk = new Error('ENOSPC');
    const session = sessionIdSchema.parse('reader');

    store.failWith(disk);

    for (const write of [
      () => store.entries(id).append(entry(0)),
      () => store.writeIndex(stored(id, 1)),
      () => store.writeMessages({ id, messages: [] }),
      () => store.writeAgentMessages({ id, session, messages: [] }),
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
