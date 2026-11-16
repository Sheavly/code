import { describe, expect, it } from 'vitest';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { SessionRegistry } from '../sessions.service.js';

const id = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');

const failures = (entries: StreamEntry[]) =>
  entries.filter((entry) => entry.kind === 'event' && entry.event.type === 'storage_failed');

/** A registry kept in a memory store, its main session, and every entry a listener heard. */
function keptRegistry() {
  const store = new MemoryConversationStore();
  const sessions = new SessionRegistry({ store: store.entries(id) });
  const main = sessions.startMain({ title: 'Main' });
  const heard: StreamEntry[] = [];

  sessions.subscribeEntries((entry) => heard.push(entry), { replay: true });

  return { store, sessions, main, heard };
}

describe('a registry whose store fails', () => {
  it('puts one storage_failed entry on the stream, under the main session, not one per write', async () => {
    const { store, sessions, main, heard } = keptRegistry();

    await sessions.flushStore();
    store.failWith(new Error('ENOSPC'));
    sessions.report({ id: main.id, status: 'one' });
    sessions.report({ id: main.id, status: 'two' });
    await sessions.flushStore();
    await sessions.recoverStore();

    const [failed, ...more] = failures(heard);

    expect(more).toEqual([]);
    expect(failed).toMatchObject({
      sessionId: main.id,
      kind: 'event',
      event: { type: 'storage_failed' },
    });
    expect(sessions.storageFailure).toBeDefined();
  });

  it('says nothing more after it recovers: one entry for the one failure', async () => {
    const { store, sessions, main, heard } = keptRegistry();

    store.failWith(new Error('ENOSPC'));
    sessions.report({ id: main.id, status: 'x' });
    await sessions.flushStore();
    store.failWith(undefined);
    await sessions.recoverStore();

    expect(sessions.storageFailure).toBeUndefined();
    expect(failures(heard)).toHaveLength(1);
  });
});
