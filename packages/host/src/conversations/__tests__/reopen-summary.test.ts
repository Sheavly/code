import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { indexOf } from '@sheavly/testing/store/store-contract.fake';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { say, scriptedConversations as setup } from '../../testing/conversations.fake.js';
import { FAST_ID } from '../../testing/run.fake.js';
import { loggedSeqs, seedMainSession } from '../../testing/stored-conversation.fake.js';

const id = conversationIdSchema.parse('00000000-0000-4000-8000-0000000000dd');
const user = (content: string, at: number): HistoryMessage => ({ role: 'user', content, at });
const reply = (content: string, at: number): HistoryMessage => ({
  role: 'assistant',
  content,
  toolCalls: [],
  at,
});

/** Three exchanges, then a checkpoint over the first two that keeps the last one word for word. */
const stored: HistoryMessage[] = [
  user('first', 1),
  reply('one', 2),
  user('second', 3),
  reply('two', 4),
  user('third', 5),
  {
    role: 'summary',
    sections: [{ id: summarySectionIdSchema.parse('goal'), title: 'Goal', body: 'Talked.' }],
    kept: 1,
    summarized: 4,
    covered: 4,
    summarizer: 'test',
    at: 6,
  },
];

async function keptWithCheckpoint() {
  const store = new MemoryConversationStore();

  await store.history({ id }).append(stored.map((entry, seq) => ({ seq, entry })));
  await store.writeIndex({ ...indexOf(id, 1), modelId: FAST_ID, updatedAt: 6 });
  // The conversation ended well: its main session is idle, so it can take the next prompt.
  await seedMainSession({ store, id, state: 'idle' });

  return store;
}

describe('reopening a conversation that holds a checkpoint', () => {
  it('restores the whole history, original entries and checkpoint, without regenerating it', async () => {
    const store = await keptWithCheckpoint();
    const { conversations } = setup({ store, replies: [] });

    await conversations.reopen(id);

    // Every original entry is still there, in order, with the checkpoint after them.
    expect(conversations.messages(id)).toEqual(stored);
  });

  it('is safe to reopen twice at once: one conversation, nothing logged twice', async () => {
    const store = await keptWithCheckpoint();
    const { conversations } = setup({ store, replies: [] });

    await Promise.all([conversations.reopen(id), conversations.reopen(id)]);
    await conversations.get(id).harness.sessions.flushStore();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(conversations.list()).toHaveLength(1);
    expect(await loggedSeqs({ store, id })).toEqual(stored.map((_, index) => index));
    // No write failed, so the conversation still takes a prompt.
    await expect(conversations.send({ id, prompt: { text: 'next' } })).resolves.toBeDefined();
  });

  it('shows a model the checkpoint and the tail, and logs the next entries after the last one', async () => {
    const store = await keptWithCheckpoint();
    const { conversations, sent } = setup({ store, replies: [say('again')] });

    await conversations.reopen(id);
    await collect((await conversations.send({ id, prompt: { text: 'fourth' } })).events);
    await conversations.get(id).harness.sessions.flushStore();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const first = sent[0]?.map((message) => message.content) ?? [];

    expect(first[0]).toContain('Talked.');
    expect(first).toContain('third');
    expect(first).not.toContain('first');

    const seqs = await loggedSeqs({ store, id });

    // The originals and the checkpoint stay, and new entries follow with no gap or repeat.
    expect(seqs).toEqual(seqs.map((_, index) => index));
    expect(seqs.length).toBeGreaterThan(stored.length);
  });
});
