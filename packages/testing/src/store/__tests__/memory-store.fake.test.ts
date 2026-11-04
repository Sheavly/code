import { describe, expect, it } from 'vitest';
import { StoreError } from '@sheavly/core/errors/store.errors';
import { MemoryConversationStore } from '../memory-store.fake.js';
import {
  CONVERSATION as id,
  READER as session,
  describeConversationStore,
  entry,
  indexOf,
} from '../store-contract.fake.js';

describeConversationStore({
  name: 'MemoryConversationStore',
  make: () => new MemoryConversationStore(),
});

describe('MemoryConversationStore', () => {
  it('hands out copies of its entries, so a reader cannot change what is stored', async () => {
    const store = new MemoryConversationStore();

    await store.entries(id).append(entry(0));

    for await (const each of store.entries(id).read()) {
      if (each.kind === 'event' && each.event.type === 'text_delta') each.event.text = 'changed';
    }

    for await (const each of store.entries(id).read()) {
      expect(each).toEqual(entry(0));
    }
  });

  it('fails every write while told to, as a full disk does, then mends', async () => {
    const store = new MemoryConversationStore();
    const disk = new Error('ENOSPC');

    store.failWith(disk);

    for (const write of [
      () => store.entries(id).append(entry(0)),
      () => store.writeIndex(indexOf(id, 1)),
      () => store.writeMessages({ id, messages: [] }),
      () => store.writeAgentMessages({ id, session, messages: [] }),
      () => store.delete(id),
    ]) {
      await expect(write()).rejects.toBeInstanceOf(StoreError);
      await expect(write()).rejects.toMatchObject({ reason: 'failed', cause: disk });
    }

    store.failWith(undefined);
    await store.entries(id).append(entry(0));

    const seqs: number[] = [];

    for await (const each of store.entries(id).read()) seqs.push(each.seq);
    expect(seqs).toHaveLength(1);
  });
});
