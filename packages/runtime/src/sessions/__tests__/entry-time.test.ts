import { describe, expect, it } from 'vitest';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { SessionRegistry } from '../sessions.service.js';

const id = conversationIdSchema.parse('c1');

describe('the time a stream entry carries', () => {
  const clock = useFixedClock();

  it('stamps each entry with the moment it was added, in order', () => {
    const sessions = new SessionRegistry();
    const times: number[] = [];

    sessions.subscribeEntries((entry) => times.push(entry.at));

    const main = sessions.startMain({ title: 'Main' });

    clock.advance(250);
    sessions.publish({ sessionId: main.id, event: { seq: 0, type: 'text_delta', text: 'a' } });
    clock.advance(1_000);
    sessions.report({ id: main.id, status: 'working' });

    expect(times).toEqual([clock.at - 1_250, clock.at - 1_000, clock.at]);
  });

  it('keeps the same time on replay, from memory and from the store', async () => {
    const store = new MemoryConversationStore();
    const sessions = new SessionRegistry({ store: store.entries(id) });
    const main = sessions.startMain({ title: 'Main' });
    const started = clock.at;

    clock.advance(5_000);
    sessions.publish({ sessionId: main.id, event: { seq: 0, type: 'text_delta', text: 'a' } });
    await sessions.flushStore();

    const replayed: number[] = [];
    const stored: number[] = [];

    sessions.subscribeEntries((entry) => replayed.push(entry.at), { replay: true });

    for await (const entry of store.entries(id).read()) stored.push(entry.at);

    expect(replayed).toEqual([started, started + 5_000]);
    expect(stored).toEqual(replayed);
  });

  it('stamps a session with the same clock, so a UI can order the two', () => {
    const sessions = new SessionRegistry();
    const main = sessions.startMain({ title: 'Main' });

    clock.advance(3_000);
    sessions.end({ id: main.id, state: 'completed' });

    expect(sessions.get(main.id)).toMatchObject({
      startedAt: clock.at - 3_000,
      endedAt: clock.at,
    });
  });
});
