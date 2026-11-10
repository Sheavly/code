import { describe, expect, it } from 'vitest';
import type { ConversationStore } from '@sheavly/core/store/store.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';

const id = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
const other = conversationIdSchema.parse('00000000-0000-4000-8000-000000000002');
const reader = sessionIdSchema.parse('7d9a2c41-5e0b-4f63-8a17-3c6e9b1d4f20');
const writer = sessionIdSchema.parse('c3b81f6e-92a4-4d07-b5e9-18a7d0c64e35');
const SECTION = summarySectionIdSchema.parse('goal');

/** Test-only: the first conversation id the store tests use. */
export const CONVERSATION = id;
/** Test-only: a sub-agent session id a store may name a file after (a UUID). */
export const READER = reader;

/** Test-only: a stream entry with this `seq`, a text delta from the main session. */
export const entry = (seq: number): StreamEntry => ({
  seq,
  at: 0,
  sessionId: sessionIdSchema.parse('main'),
  kind: 'event',
  event: { seq, type: 'text_delta', text: `t${String(seq)}` },
});
/**
 * Test-only: the index entry of conversation `conversationId`, started at `startedAt`, in the
 * workspace `/work` on a profile with the id below.
 */
export const indexOf = (conversationId: typeof id, startedAt: number, title = 'Chat') => ({
  id: conversationId,
  title,
  modelId: modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30'),
  workspace: '/work',
  profile: profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b99'),
  status: 'open' as const,
  startedAt,
  updatedAt: startedAt,
});

async function seqsOf(params: { store: ConversationStore; from?: number }) {
  const seqs: number[] = [];

  for await (const each of params.store.entries(id).read(params.from)) seqs.push(each.seq);

  return seqs;
}

/**
 * Test-only: what every `ConversationStore` must do, whatever it keeps conversations in. Call it
 * in a test file with a `make` that returns a store with nothing in it (a new one for each test),
 * so the in-memory fake and a real store are held to the same rules and cannot drift apart.
 */
export function describeConversationStore(params: { name: string; make: () => ConversationStore }) {
  const { name, make } = params;

  describe(`${name} as a ConversationStore`, () => {
    it('reads back the entries it was given, from any seq, and none for a conversation it has not', async () => {
      const store = make();

      for (const seq of [0, 1, 2]) await store.entries(id).append(entry(seq));

      expect(await seqsOf({ store })).toEqual([0, 1, 2]);
      expect(await seqsOf({ store, from: 2 })).toEqual([2]);

      const none: number[] = [];

      for await (const each of store.entries(other).read()) none.push(each.seq);
      expect(none).toEqual([]);
    });

    it('refuses an entry that is not the next one, so a lost write cannot hide', async () => {
      const store = make();

      await store.entries(id).append(entry(0));

      for (const seq of [0, 2]) {
        await expect(store.entries(id).append(entry(seq))).rejects.toMatchObject({
          name: 'StoreError',
          reason: 'out_of_order',
        });
      }

      expect(await seqsOf({ store })).toEqual([0]);
      await store.entries(id).append(entry(1));
      expect(await seqsOf({ store })).toEqual([0, 1]);
    });

    it('keeps each conversation’s entries apart', async () => {
      const store = make();

      await store.entries(id).append(entry(0));
      await store.entries(other).append(entry(0));
      await store.entries(other).append(entry(1));

      expect(await seqsOf({ store })).toEqual([0]);
    });

    it('lists the index oldest first, and replaces the entry of a conversation it writes again', async () => {
      const store = make();

      await store.writeIndex(indexOf(other, 20));
      await store.writeIndex(indexOf(id, 10, 'First'));
      await store.writeIndex(indexOf(id, 10, 'Renamed'));

      expect(await store.list()).toMatchObject([
        { id, title: 'Renamed' },
        { id: other, title: 'Chat' },
      ]);
    });

    it('keeps the history it was given whole, as a copy, and none for a conversation it has not', async () => {
      const store = make();
      const first: Message = { role: 'user', content: 'hi', at: 1 };
      const messages: HistoryMessage[] = [
        first,
        { role: 'assistant', content: 'hello', toolCalls: [], at: 2 },
        {
          role: 'summary',
          sections: [{ id: SECTION, title: 'Goal', body: 'Say hello.' }],
          kept: 1,
          summarized: 1,
          summarizer: 'test',
          at: 3,
        },
      ];

      expect(await store.readMessages(id)).toEqual([]);
      await store.writeMessages({ id, messages });

      const read = await store.readMessages(id);

      expect(read).toEqual(messages);
      read.pop();
      expect(await store.readMessages(id)).toHaveLength(3);

      await store.writeMessages({ id, messages: [first] });
      expect(await store.readMessages(id)).toEqual([first]);
      expect(await store.readMessages(other)).toEqual([]);
    });

    it('keeps each sub-agent’s history apart: from the conversation’s, other agents’, and other conversations’', async () => {
      const store = make();
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

    it('replaces a sub-agent’s history whole, as a copy', async () => {
      const store = make();
      const messages: Message[] = [
        { role: 'user', content: 'one', at: 1 },
        { role: 'assistant', content: 'two', toolCalls: [], at: 2 },
      ];

      await store.writeAgentMessages({ id, session: reader, messages });

      const copy = await store.readAgentMessages({ id, session: reader });

      copy.pop();
      messages.pop();
      expect(await store.readAgentMessages({ id, session: reader })).toHaveLength(2);

      await store.writeAgentMessages({
        id,
        session: reader,
        messages: [{ role: 'user', content: 'again' }],
      });
      expect(await store.readAgentMessages({ id, session: reader })).toEqual([
        { role: 'user', content: 'again' },
      ]);
    });

    it('deletes a conversation with its entries, history, sub-agents’ histories and index, and no other', async () => {
      const store = make();

      for (const conversation of [id, other]) {
        await store.writeIndex(indexOf(conversation, 10));
        await store.entries(conversation).append(entry(0));
        await store.writeMessages({
          id: conversation,
          messages: [{ role: 'user', content: 'hi' }],
        });
        await store.writeAgentMessages({
          id: conversation,
          session: reader,
          messages: [{ role: 'user', content: 'read it' }],
        });
      }

      await store.delete(id);
      await store.delete(id);

      expect((await store.list()).map((c) => c.id)).toEqual([other]);
      expect(await seqsOf({ store })).toEqual([]);
      expect(await store.readMessages(id)).toEqual([]);
      expect(await store.readAgentMessages({ id, session: reader })).toEqual([]);
      expect(await store.readMessages(other)).toHaveLength(1);
      expect(await store.readAgentMessages({ id: other, session: reader })).toHaveLength(1);
    });

    it('starts a deleted conversation again from its first entry', async () => {
      const store = make();

      await store.entries(id).append(entry(0));
      await store.entries(id).append(entry(1));
      await store.delete(id);

      await expect(store.entries(id).append(entry(2))).rejects.toMatchObject({
        reason: 'out_of_order',
      });
      await store.entries(id).append(entry(0));
      expect(await seqsOf({ store })).toEqual([0]);
    });
  });
}
