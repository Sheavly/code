import { describe, expect, it } from 'vitest';
import type { ConversationStore } from '@sheavly/core/store/store.types';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';

const id = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
const other = conversationIdSchema.parse('00000000-0000-4000-8000-000000000002');
const reader = sessionIdSchema.parse('7d9a2c41-5e0b-4f63-8a17-3c6e9b1d4f20');

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
  mode: 'medium' as const,
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

    it('appends history records in seq order, reads from any seq, and keeps sessions apart', async () => {
      const store = make();
      const record = (seq: number) => ({
        seq,
        entry: { role: 'user' as const, content: `m${String(seq)}`, at: seq },
      });
      const seqsOfLog = async (session?: typeof reader, from?: number) => {
        const seqs: number[] = [];

        for await (const each of store.history({ id, session }).read(from)) seqs.push(each.seq);

        return seqs;
      };

      await store.history({ id }).append([record(0), record(1)]);
      await store.history({ id }).append([record(2)]);
      await store.history({ id, session: reader }).append([record(0)]);

      expect(await seqsOfLog()).toEqual([0, 1, 2]);
      expect(await seqsOfLog(undefined, 2)).toEqual([2]);
      expect(await seqsOfLog(reader)).toEqual([0]);

      for (const seqs of [[0], [4], [3, 5]]) {
        await expect(store.history({ id }).append(seqs.map(record))).rejects.toMatchObject({
          name: 'StoreError',
          reason: 'out_of_order',
        });
      }

      expect(await seqsOfLog()).toEqual([0, 1, 2]);
    });

    it('keeps a conversation’s queue apart from its history, and drops it with the conversation', async () => {
      const store = make();

      expect(await store.queue(id).load()).toBeUndefined();
      await store.queue(id).update(() => ({ queued: ['one', 'two'] }));
      await store.queue(other).update(() => ({ queued: ['other'] }));

      expect(await store.queue(id).load()).toEqual({ queued: ['one', 'two'] });
      expect(await store.queue(other).load()).toEqual({ queued: ['other'] });

      const records: number[] = [];

      for await (const record of store.history({ id }).read()) records.push(record.seq);
      expect(records).toEqual([]);

      await store.delete(id);
      expect(await store.queue(id).load()).toBeUndefined();
      expect(await store.queue(other).load()).toEqual({ queued: ['other'] });
    });

    it('deletes a conversation with its history logs, so it starts again from record 0', async () => {
      const store = make();
      const first = { seq: 0, entry: { role: 'user' as const, content: 'hi' } };

      await store.history({ id }).append([first]);
      await store.delete(id);

      const left: number[] = [];

      for await (const each of store.history({ id }).read()) left.push(each.seq);
      expect(left).toEqual([]);
      await store.history({ id }).append([first]);
    });

    it('deletes a conversation with its entries, history logs and index, and no other', async () => {
      const store = make();
      const first = { seq: 0, entry: { role: 'user' as const, content: 'hi' } };
      const seqsOfLog = async (conversation: typeof id, session?: typeof reader) => {
        const seqs: number[] = [];

        for await (const each of store.history({ id: conversation, session }).read()) {
          seqs.push(each.seq);
        }

        return seqs;
      };

      for (const conversation of [id, other]) {
        await store.writeIndex(indexOf(conversation, 10));
        await store.entries(conversation).append(entry(0));
        await store.history({ id: conversation }).append([first]);
        await store.history({ id: conversation, session: reader }).append([first]);
      }

      await store.delete(id);
      await store.delete(id);

      expect((await store.list()).map((c) => c.id)).toEqual([other]);
      expect(await seqsOf({ store })).toEqual([]);
      expect(await seqsOfLog(id)).toEqual([]);
      expect(await seqsOfLog(id, reader)).toEqual([]);
      expect(await seqsOfLog(other)).toEqual([0]);
      expect(await seqsOfLog(other, reader)).toEqual([0]);
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
