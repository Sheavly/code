import { describe, expect, it } from 'vitest';
import { StoreError } from '@sheavly/core/errors/store.errors';
import type { EntryStore } from '@sheavly/core/store/store.types';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { SessionRegistry } from '../sessions.service.js';
import { STARTED_BY } from '../../testing/sessions.fake.js';
import { ENTRY_TAIL_SIZE } from '../sessions.constants.js';
import { readStoredLog } from '../stored-log.helper.js';

const id = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
const text = (value: string) => ({ seq: 0, type: 'text_delta' as const, text: value });

/** A conversation that ran, left behind in `store`: a main session with one sub-agent. */
async function ranConversation(params: { store: MemoryConversationStore; childEnds: boolean }) {
  const sessions = new SessionRegistry({ store: params.store.entries(id) });
  const main = sessions.startMain({ title: 'Chat' });
  const child = sessions.startChild({
    parentId: main.id,
    startedByCall: STARTED_BY,
    title: 'Reader',
  });

  sessions.publish({ sessionId: main.id, event: text('main says') });
  sessions.publish({ sessionId: child.id, event: text('child says') });
  if (params.childEnds) sessions.end({ id: child.id, state: 'completed' });
  sessions.idle({ id: main.id, outcome: 'completed' });
  await sessions.flushStore();

  return { main, child };
}

/** A registry that carries on from what `store` holds, as a reopened conversation does. */
async function reopened(store: MemoryConversationStore) {
  const resume = await readStoredLog(store.entries(id));

  return new SessionRegistry({ store: store.entries(id), resume });
}

/** The `seq`s of every entry a replay hands out, once it has run. */
async function replayedSeqs(sessions: SessionRegistry) {
  const heard: StreamEntry[] = [];

  sessions.subscribeEntries((entry) => heard.push(entry), { replay: true });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  return heard.map((entry) => entry.seq);
}

describe('carrying on a stored conversation', () => {
  const clock = useFixedClock();

  it('numbers new entries after the stored ones, with no gap and no repeat', async () => {
    const store = new MemoryConversationStore();
    const { main } = await ranConversation({ store, childEnds: true });
    const sessions = await reopened(store);

    sessions.resume(main.id);
    sessions.publish({ sessionId: main.id, event: text('next prompt') });
    await sessions.flushStore();

    const seqs = await replayedSeqs(sessions);

    expect(seqs).toEqual(seqs.map((_, index) => index));
    // What it wrote is in the store too, so a later reopen finds all of it.
    expect((await readStoredLog(store.entries(id))).next).toBe(seqs.length);
  });

  it('restores the main session idle for its next prompt, with its title', async () => {
    const store = new MemoryConversationStore();
    const { main } = await ranConversation({ store, childEnds: true });
    const sessions = await reopened(store);

    expect(sessions.restoredMain()).toMatchObject({ id: main.id, depth: 1 });
    expect(sessions.get(main.id)).toMatchObject({ state: 'idle', title: 'Chat' });
    expect(() => sessions.resume(main.id)).not.toThrow();
  });

  it('settles a sub-agent that was still open as interrupted, and says so in the stream', async () => {
    const store = new MemoryConversationStore();
    const { child } = await ranConversation({ store, childEnds: false });
    const before = clock.at;

    clock.advance(60_000);

    const sessions = await reopened(store);
    const heard: StreamEntry[] = [];

    sessions.subscribeEntries((entry) => heard.push(entry), { replay: true });

    expect(sessions.get(child.id)).toMatchObject({
      state: 'interrupted',
      lastOutcome: 'interrupted',
      endedAt: before + 60_000,
    });
    expect(heard.at(-1)).toMatchObject({
      kind: 'update',
      update: { type: 'session_ended', session: { id: child.id, state: 'interrupted' } },
    });
  });

  it('leaves a sub-agent that finished as it finished', async () => {
    const store = new MemoryConversationStore();
    const { child } = await ranConversation({ store, childEnds: true });
    const sessions = await reopened(store);

    expect(sessions.get(child.id)).toMatchObject({ state: 'completed' });
  });

  it('brings back a conversation that was closed, idle and ready for a prompt', async () => {
    const store = new MemoryConversationStore();
    const sessions = new SessionRegistry({ store: store.entries(id) });
    const main = sessions.startMain({ title: 'Chat' });

    sessions.end({ id: main.id, state: 'completed' });
    await sessions.flushStore();

    const back = await reopened(store);

    expect(back.get(main.id)).toMatchObject({ state: 'idle', lastOutcome: 'completed' });
    expect(back.get(main.id)?.endedAt).toBeUndefined();
  });

  it('finds a sub-agent’s old entries by its subtree after memory dropped them', async () => {
    const store = new MemoryConversationStore();
    const { main, child } = await ranConversation({ store, childEnds: true });
    const sessions = await reopened(store);

    // Enough more entries that the old ones are only in the store.
    for (let i = 0; i < ENTRY_TAIL_SIZE + 10; i++) {
      sessions.publish({ sessionId: main.id, event: text(`later ${String(i)}`) });
    }

    await sessions.flushStore();

    const heard: StreamEntry[] = [];

    sessions.subscribeEntries((entry) => heard.push(entry), {
      sessionId: child.id,
      subtree: true,
      replay: true,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(sessions.retainedEntries).toBe(ENTRY_TAIL_SIZE);
    expect(heard.every((entry) => entry.sessionId === child.id)).toBe(true);
    expect(heard.some((entry) => entry.kind === 'event')).toBe(true);
  });

  it('refuses to resume a conversation whose stored entries have a gap', async () => {
    const entry = (seq: number): StreamEntry => ({
      seq,
      at: 0,
      sessionId: sessionIdSchema.parse('main'),
      kind: 'event',
      event: text('a'),
    });
    const gappy: EntryStore = {
      append: async () => undefined,
      read: async function* read() {
        await Promise.resolve();
        yield entry(0);
        yield entry(5);
      },
    };

    await expect(readStoredLog(gappy)).rejects.toBeInstanceOf(StoreError);
  });
});
