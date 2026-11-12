import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { indexOf } from '@sheavly/testing/store/store-contract.fake';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { summarySectionIdSchema } from '@sheavly/protocol/message/message.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { say, scriptedConversations as setup } from '../../testing/conversations.fake.js';
import { FAST_ID } from '../../testing/run.fake.js';

const id = conversationIdSchema.parse('00000000-0000-4000-8000-0000000000dd');
const main = sessionIdSchema.parse('main');
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
  await store.entries(id).append({
    seq: 0,
    at: 1,
    sessionId: main,
    kind: 'update',
    update: {
      type: 'session_started',
      session: { id: main, rootId: main, depth: 1, title: 'Chat', state: 'idle', startedAt: 1 },
    },
  });

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

    const seqs: number[] = [];

    for await (const record of store.history({ id }).read()) seqs.push(record.seq);

    // The originals and the checkpoint stay, and new entries follow with no gap or repeat.
    expect(seqs).toEqual(seqs.map((_, index) => index));
    expect(seqs.length).toBeGreaterThan(stored.length);
  });
});
