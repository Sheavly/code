import { describe, expect, it } from 'vitest';
import { streamEntrySchema } from '@sheavly/protocol/stream/stream.validator';
import { EntryQueue } from '../entry-queue.service.js';

const entry = (seq: number) =>
  streamEntrySchema.parse({
    seq,
    at: 0,
    sessionId: 'main',
    kind: 'event',
    event: { seq, type: 'text_delta', text: 'x' },
  });

describe('EntryQueue', () => {
  it('hands entries back oldest first', () => {
    const queue = new EntryQueue({ limit: 3, liveFrom: 0 });

    queue.push(entry(0));
    queue.push(entry(1));

    expect(queue.shift()?.seq).toBe(0);
    expect(queue.shift()?.seq).toBe(1);
    expect(queue.shift()).toBeUndefined();
  });

  it('cuts off a consumer that falls past the limit: it drops what waits and takes no more', () => {
    const queue = new EntryQueue({ limit: 2, liveFrom: 0 });

    expect(queue.push(entry(0))).toBe(true);
    expect(queue.push(entry(1))).toBe(true);
    expect(queue.push(entry(2))).toBe(false);

    expect(queue.overflowed).toBe(true);
    expect(queue.shift()).toBeUndefined();
    expect(queue.push(entry(3))).toBe(false);
  });

  it('keeps taking entries while the consumer keeps up', () => {
    const queue = new EntryQueue({ limit: 1, liveFrom: 0 });

    for (let seq = 0; seq < 10; seq++) {
      expect(queue.push(entry(seq))).toBe(true);
      expect(queue.shift()?.seq).toBe(seq);
    }

    expect(queue.overflowed).toBe(false);
  });

  it('does not count a replay of history against the bound: only live entries are', () => {
    const queue = new EntryQueue({ limit: 2, liveFrom: 100 });

    for (let seq = 0; seq < 100; seq++) expect(queue.push(entry(seq))).toBe(true);

    expect(queue.push(entry(100))).toBe(true);
    expect(queue.push(entry(101))).toBe(true);
    expect(queue.overflowed).toBe(false);

    // Reading drains history first, which is not live and so frees no live room.
    for (let read = 0; read < 100; read++) queue.shift();

    expect(queue.push(entry(102))).toBe(false);
    expect(queue.overflowed).toBe(true);
  });
});
