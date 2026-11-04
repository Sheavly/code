import { describe, expect, it } from 'vitest';
import { StoreError } from '@sheavly/core/errors/store.errors';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import type { Message } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { createConversation } from '../../conversation/conversation.helper.js';
import { createHarness } from '../../host/host.helper.js';
import { say, scriptedConversations as setup } from '../../testing/conversations.fake.js';
import { DEEP_ID, FAST_ID } from '../../testing/run.fake.js';
import { Conversations } from '../conversations.service.js';

/** A conversation that ran one prompt on `store` and was closed, as a process that ended well. */
async function pastConversation(store: MemoryConversationStore) {
  const first = setup({ store, replies: [say('one')] });
  const id = await first.conversations.start();

  await collect((await first.conversations.send({ id, prompt: { text: 'first' } })).events);
  await first.conversations.close(id);

  return id;
}

/** Lets the host's queued writes finish, as an app waits for its disk. */
const settled = async (
  conversations: Conversations,
  id: ReturnType<typeof conversationIdSchema.parse>,
) => {
  await conversations.get(id).harness.sessions.flushStore();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe('Conversations with a store', () => {
  const clock = useFixedClock();

  it('keeps the model last used by id, so a switch is what a reopened conversation finds', async () => {
    const store = new MemoryConversationStore();
    const { conversations } = setup({ store, replies: [] });
    const id = await conversations.start();

    conversations.useModel({ id, modelId: DEEP_ID });
    await settled(conversations, id);

    // Both models are labelled "Astra": the index could not say which, the id does.
    expect(await conversations.listStored()).toMatchObject([{ id, modelId: DEEP_ID }]);
  });

  it('keeps a conversation as it runs: its index, history and stream', async () => {
    const store = new MemoryConversationStore();
    const { conversations } = setup({ store, replies: [say('hello')] });
    const id = await conversations.start();

    clock.advance(1_000);
    await collect((await conversations.send({ id, prompt: { text: 'hi' } })).events);
    await settled(conversations, id);

    expect(await conversations.listStored()).toMatchObject([
      { id, title: 'Chat', modelId: FAST_ID, status: 'open' },
    ]);
    expect((await store.readMessages(id)).map((m) => [m.role, m.content])).toEqual([
      ['user', 'hi'],
      ['assistant', 'hello'],
    ]);

    const stored: string[] = [];

    for await (const entry of store.entries(id).read()) {
      stored.push(entry.kind === 'event' ? entry.event.type : entry.update.type);
    }

    expect(stored).toContain('session_started');
    expect(stored).toContain('text_delta');
    // The session goes idle, then the run's `done` closes the prompt.
    expect(stored.slice(-2)).toEqual(['session_idle', 'done']);
  });

  it('marks a closed conversation closed, and keeps it', async () => {
    const store = new MemoryConversationStore();
    const { conversations } = setup({ store, replies: [say('ok')] });
    const id = await conversations.start();

    await collect((await conversations.send({ id, prompt: { text: 'hi' } })).events);
    await conversations.close(id);

    expect(await conversations.listStored()).toMatchObject([{ id, status: 'closed' }]);
    expect(await store.readMessages(id)).toHaveLength(2);
  });

  it('lists an open conversation no live one owns as interrupted: its process ended', async () => {
    const store = new MemoryConversationStore();
    const first = setup({ store, replies: [say('ok')] });
    const id = await first.conversations.start();

    await collect((await first.conversations.send({ id, prompt: { text: 'hi' } })).events);
    await settled(first.conversations, id);

    // A new host on the same store: the first process is gone, and never closed it.
    const second = setup({ store, replies: [say('again')] });

    expect(await second.conversations.listStored()).toMatchObject([{ id, status: 'interrupted' }]);
    expect(await first.conversations.listStored()).toMatchObject([{ id, status: 'open' }]);
  });

  it('reopens a stored conversation under its id, continuing from its history', async () => {
    const store = new MemoryConversationStore();
    const id = await pastConversation(store);
    const second = setup({ store, replies: [say('two')] });

    expect(await second.conversations.reopen(id)).toBe(id);
    await collect((await second.conversations.send({ id, prompt: { text: 'second' } })).events);

    // The model saw what came before, then the new prompt.
    expect(second.sent[0]?.map((m) => m.content)).toEqual(['first', 'one', 'second']);
    expect((await store.readMessages(id)).map((m) => m.content)).toEqual([
      'first',
      'one',
      'second',
      'two',
    ]);
    expect(await second.conversations.listStored()).toMatchObject([{ id, status: 'open' }]);
  });

  it('numbers a reopened conversation’s stream on from where it stopped', async () => {
    const store = new MemoryConversationStore();
    const id = await pastConversation(store);
    const second = setup({ store, replies: [say('two')] });

    await second.conversations.reopen(id);
    await collect((await second.conversations.send({ id, prompt: { text: 'second' } })).events);
    await settled(second.conversations, id);

    const seqs: number[] = [];

    for await (const entry of store.entries(id).read()) seqs.push(entry.seq);

    expect(seqs).toEqual(seqs.map((_, index) => index));
    expect(seqs.length).toBeGreaterThan(8);
  });

  it('repairs a history cut off mid-tool-call, so a model can continue from it', async () => {
    const store = new MemoryConversationStore();
    const id = conversationIdSchema.parse('cut-off');
    const main = sessionIdSchema.parse('main');
    const asking: Message = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: callIdSchema.parse('b1'), name: 'block', input: {} }],
      at: 2,
    };

    await store.writeMessages({ id, messages: [{ role: 'user', content: 'go', at: 1 }, asking] });
    await store.writeIndex({
      id,
      title: 'Chat',
      modelId: FAST_ID,
      status: 'open',
      startedAt: 1,
      updatedAt: 2,
    });
    await store.entries(id).append({
      seq: 0,
      at: 1,
      sessionId: main,
      kind: 'update',
      update: {
        type: 'session_started',
        session: {
          id: main,
          rootId: main,
          depth: 1,
          title: 'Chat',
          state: 'running',
          startedAt: 1,
        },
      },
    });

    const { conversations } = setup({ store, replies: [say('recovered')] });

    await conversations.reopen(id);

    const messages = conversations.messages(id);

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(messages.at(-1)).toMatchObject({ role: 'tool', isError: true });
  });

  it('refuses a reopen of a conversation the store does not have', async () => {
    const { conversations } = setup({ store: new MemoryConversationStore(), replies: [] });

    await expect(conversations.reopen(conversationIdSchema.parse('nope'))).rejects.toMatchObject({
      reason: 'not_found',
    });
  });

  it('refuses the next prompt once storage fails, rather than carry on unrecorded', async () => {
    const store = new MemoryConversationStore();
    const { conversations } = setup({ store, replies: [say('one'), say('two')] });
    const id = await conversations.start();

    await collect((await conversations.send({ id, prompt: { text: 'fine' } })).events);
    await settled(conversations, id);
    store.failWith(new Error('ENOSPC'));
    await collect((await conversations.send({ id, prompt: { text: 'lost' } })).events);
    await settled(conversations, id);

    await expect(conversations.send({ id, prompt: { text: 'refused' } })).rejects.toMatchObject({
      name: 'ConversationsError',
      reason: 'storage_failed',
      cause: expect.any(StoreError) as StoreError,
    });
  });

  it('keeps nothing and refuses nothing when the host has no store', async () => {
    const conversations = new Conversations({
      create: async ({ messages }) => {
        const harness = createHarness({ provider: scriptedProvider([say('ok')]), title: 'Chat' });

        return {
          harness,
          conversation: createConversation({
            harness,
            run: streamAgent,
            tools: [],
            messages: messages ?? [],
          }),
        };
      },
    });
    const id = await conversations.start();

    await collect((await conversations.send({ id, prompt: { text: 'hi' } })).events);

    expect(await conversations.listStored()).toEqual([]);
    await expect(conversations.reopen(id)).resolves.toBe(id);
  });
});
