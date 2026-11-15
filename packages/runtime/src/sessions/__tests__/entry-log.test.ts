import { describe, expect, it } from 'vitest';
import { StoreError } from '@sheavly/core/errors/store.errors';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { EntryLog } from '../entry-log.service.js';
import { ENTRY_TAIL_SIZE } from '../sessions.constants.js';

const id = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
const main = sessionIdSchema.parse('main');
const noLineage = () => [];

/** Adds `count` events to `log`, numbered as it assigns. */
function addEvents(params: { log: EntryLog; count: number }) {
  for (let i = 0; i < params.count; i++) {
    params.log.add((seq) => ({
      seq,
      sessionId: main,
      kind: 'event',
      event: { seq, type: 'text_delta', text: String(seq) },
    }));
  }
}

const seqs = (entries: StreamEntry[]) => entries.map((entry) => entry.seq);
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** Waits for the next macrotask: the replay's reads and the queued listeners have run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The `seq`s the store holds for the conversation, in the order it keeps them. */
async function storedSeqs(store: MemoryConversationStore) {
  const stored: StreamEntry[] = [];

  for await (const entry of store.entries(id).read()) stored.push(entry);

  return seqs(stored);
}

/** Subscribes with a replay and collects what the listener is handed. */
function replayInto(params: {
  log: EntryLog;
  sessionId?: typeof main;
  onError?: (error: StoreError) => void;
}) {
  const heard: StreamEntry[] = [];
  const stop = params.log.subscribe({
    listener: (entry) => heard.push(entry),
    filter: { replay: true, ...(params.sessionId && { sessionId: params.sessionId }) },
    ...(params.onError && { onError: params.onError }),
  });

  return { heard, stop };
}

describe('an entry log without a store', () => {
  it('keeps only the newest in memory and replays from the oldest it still holds', () => {
    const log = new EntryLog({ lineage: noLineage });
    const total = ENTRY_TAIL_SIZE * 3;

    addEvents({ log, count: total });

    expect(log.retained).toBe(ENTRY_TAIL_SIZE);
    expect(seqs(replayInto({ log }).heard)).toEqual(range(total - ENTRY_TAIL_SIZE, total));
  });

  it('numbers new entries on from the dropped ones', () => {
    const log = new EntryLog({ lineage: noLineage });
    const heard: StreamEntry[] = [];

    addEvents({ log, count: ENTRY_TAIL_SIZE + 5 });
    log.subscribe({ listener: (entry) => heard.push(entry) });
    addEvents({ log, count: 1 });

    expect(seqs(heard)).toEqual([ENTRY_TAIL_SIZE + 5]);
  });
});

describe('an entry log with a store', () => {
  it('writes every entry in order and keeps only the newest in memory', async () => {
    const store = new MemoryConversationStore();
    const log = new EntryLog({ lineage: noLineage, store: store.entries(id) });
    const total = ENTRY_TAIL_SIZE * 3;

    addEvents({ log, count: total });
    await log.flush();

    expect(log.retained).toBe(ENTRY_TAIL_SIZE);
    expect(await storedSeqs(store)).toEqual(range(0, total));
  });

  it('replays what only the store holds, then memory, then live, with no gap or repeat', async () => {
    const store = new MemoryConversationStore();
    const log = new EntryLog({ lineage: noLineage, store: store.entries(id) });
    const total = ENTRY_TAIL_SIZE * 2 + 5;

    addEvents({ log, count: total });

    const { heard } = replayInto({ log });

    // These arrive while the old entries are still being read from the store.
    addEvents({ log, count: 3 });
    await settle();
    addEvents({ log, count: 2 });

    expect(seqs(heard)).toEqual(range(0, total + 5));
    expect(Object.isFrozen(heard[0])).toBe(true);
  });

  it('replays synchronously, as ever, while nothing has left memory', () => {
    const store = new MemoryConversationStore();
    const log = new EntryLog({ lineage: noLineage, store: store.entries(id) });

    addEvents({ log, count: 4 });

    expect(seqs(replayInto({ log }).heard)).toEqual([0, 1, 2, 3]);
  });

  it('stops replaying to a listener that leaves, and filters what it replays', async () => {
    const store = new MemoryConversationStore();
    const other = sessionIdSchema.parse('other');
    const log = new EntryLog({ lineage: noLineage, store: store.entries(id) });

    addEvents({ log, count: ENTRY_TAIL_SIZE + 10 });
    log.add((seq) => ({
      seq,
      sessionId: other,
      kind: 'event',
      event: { seq: 0, type: 'text_delta', text: 'o' },
    }));

    const only = replayInto({ log, sessionId: other });
    const left = replayInto({ log });

    left.stop();
    await settle();
    addEvents({ log, count: 1 });
    only.stop();

    expect(seqs(only.heard)).toEqual([ENTRY_TAIL_SIZE + 10]);
    expect(left.heard).toEqual([]);
  });
});

describe('an entry log whose store fails', () => {
  it('stops writing at a failure, says why, and keeps the entries in memory', async () => {
    const store = new MemoryConversationStore();
    const disk = new Error('ENOSPC');
    const log = new EntryLog({ lineage: noLineage, store: store.entries(id) });

    addEvents({ log, count: 2 });
    await log.flush();
    store.failWith(disk);
    addEvents({ log, count: 3 });
    await log.flush();
    addEvents({ log, count: 1 });
    await log.flush();

    expect(log.failure).toBeInstanceOf(StoreError);
    expect(log.failure).toMatchObject({ reason: 'failed', cause: disk });
    // Nothing after the lost entry was tried: it would have been out of order.
    expect(await storedSeqs(store)).toEqual([0, 1]);
    expect(log.retained).toBe(6);
  });

  it('writes the lost entries first, in order, once the disk is mended, and clears the failure', async () => {
    const store = new MemoryConversationStore();
    const log = new EntryLog({ lineage: noLineage, store: store.entries(id) });

    addEvents({ log, count: 2 });
    store.failWith(new Error('ENOSPC'));
    addEvents({ log, count: 3 });
    await log.flush();
    expect(log.failure).toBeInstanceOf(StoreError);

    store.failWith(undefined);
    await log.recover();

    expect(log.failure).toBeUndefined();
    expect(await storedSeqs(store)).toEqual([0, 1, 2, 3, 4]);

    addEvents({ log, count: 1 });
    await log.flush();
    expect(await storedSeqs(store)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps the failure when a recovery fails again, and loses no entry', async () => {
    const store = new MemoryConversationStore();
    const log = new EntryLog({ lineage: noLineage, store: store.entries(id) });

    store.failWith(new Error('ENOSPC'));
    addEvents({ log, count: 2 });
    await log.recover();
    expect(log.failure).toBeInstanceOf(StoreError);

    store.failWith(undefined);
    await log.recover();
    expect(await storedSeqs(store)).toEqual([0, 1]);
  });

  it('keeps the whole conversation in memory once a write has failed, so replay stays whole', async () => {
    const store = new MemoryConversationStore();
    const log = new EntryLog({ lineage: noLineage, store: store.entries(id) });

    addEvents({ log, count: 2 });
    await log.flush();
    store.failWith(new Error('ENOSPC'));
    addEvents({ log, count: 1 });
    await log.flush();
    addEvents({ log, count: ENTRY_TAIL_SIZE + 5 });

    expect(seqs(replayInto({ log }).heard)).toEqual(range(0, ENTRY_TAIL_SIZE + 8));
  });

  it('tells a replay the store cannot complete, and delivers nothing from it', async () => {
    const store = new MemoryConversationStore();
    const log = new EntryLog({ lineage: noLineage, store: store.entries(id) });
    const errors: StoreError[] = [];

    store.failWith(new Error('ENOSPC'));
    // Added in one go, before the first failed write is known: the oldest leave memory unwritten.
    addEvents({ log, count: ENTRY_TAIL_SIZE + 5 });
    await log.flush();

    const { heard } = replayInto({ log, onError: (error) => errors.push(error) });

    await settle();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ reason: 'failed' });
    expect(errors[0]?.message).toMatch(/never written/);
    expect(heard).toEqual([]);
  });
});
