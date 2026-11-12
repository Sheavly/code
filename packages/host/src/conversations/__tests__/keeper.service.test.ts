import { describe, expect, it } from 'vitest';
import { readHistoryEntries } from '@sheavly/core/store/history-log.helper';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { ConversationKeeper } from '../keeper.service.js';

const id = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
const agent = sessionIdSchema.parse('7d9a2c41-5e0b-4f63-8a17-3c6e9b1d4f20');
const user = (content: string): HistoryMessage => ({ role: 'user', content, at: 1 });

describe('ConversationKeeper sub-agent history', () => {
  it('appends only what is new to the session’s own log, apart from the main one', async () => {
    const store = new MemoryConversationStore();
    const keeper = new ConversationKeeper({ store, id });

    keeper.keepAgentHistory({ session: agent, messages: [user('task')] });
    keeper.keepAgentHistory({ session: agent, messages: [user('task'), user('more')] });
    keeper.keepHistory([user('main')]);
    await keeper.flush();

    expect(keeper.failure).toBeUndefined();
    expect(await readHistoryEntries(store.history({ id, session: agent }))).toEqual([
      user('task'),
      user('more'),
    ]);
    expect(await readHistoryEntries(store.history({ id }))).toEqual([user('main')]);
  });

  it('fails storage rather than write over a log when a history shrinks', async () => {
    const store = new MemoryConversationStore();
    const keeper = new ConversationKeeper({ store, id });

    keeper.keepAgentHistory({ session: agent, messages: [user('a'), user('b')] });
    keeper.keepAgentHistory({ session: agent, messages: [user('a')] });
    await keeper.flush();

    expect(keeper.failure).toMatchObject({ name: 'StoreError' });
    expect(await readHistoryEntries(store.history({ id, session: agent }))).toHaveLength(2);
  });

  it('writes nothing when a turn added nothing, and does not fail', async () => {
    const store = new MemoryConversationStore();
    const keeper = new ConversationKeeper({ store, id });

    keeper.keepHistory([user('a')]);
    keeper.keepHistory([user('a')]);
    keeper.keepHistory([user('a')]);
    await keeper.flush();

    expect(keeper.failure).toBeUndefined();
    expect(await readHistoryEntries(store.history({ id }))).toEqual([user('a')]);
  });

  it('stops writing after the first failure, so nothing later is recorded out of order', async () => {
    const store = new MemoryConversationStore();
    const keeper = new ConversationKeeper({ store, id });

    keeper.keepHistory([user('a'), user('b')]);
    keeper.keepHistory([user('a')]);
    keeper.keepHistory([user('a'), user('b'), user('c')]);
    await keeper.flush();

    expect(keeper.failure).toBeDefined();
    expect(await readHistoryEntries(store.history({ id }))).toHaveLength(2);
  });
});
