import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../sessions.service.js';

describe('SessionRegistry.nextSeq', () => {
  it('is the seq the next entry gets, so a subscriber can tell history from live', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Chat' });
    const before = sessions.nextSeq();
    const seen: number[] = [];

    sessions.subscribeEntries((entry) => seen.push(entry.seq), { replay: true });
    sessions.publish({ sessionId: main.id, event: { seq: 0, type: 'text_delta', text: 'x' } });

    expect(seen.filter((seq) => seq < before)).toEqual(Array.from({ length: before }, (_, i) => i));
    expect(seen.filter((seq) => seq >= before)).toEqual([before]);
    expect(sessions.nextSeq()).toBe(before + 1);
  });
});
