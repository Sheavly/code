import { describe, expect, it } from 'vitest';
import { StoreError } from '@sheavly/core/errors/store.errors';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { indexOf } from '@sheavly/testing/store/store-contract.fake';
import type { Message } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { createConversation } from '../../conversation/conversation.helper.js';
import { createHarness } from '../../host/host.helper.js';
import { say, scriptedConversations as setup } from '../../testing/conversations.fake.js';
import { DEEP_ID, FAST_ID, TEST_PROFILE_ID, twoModelRun } from '../../testing/run.fake.js';
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

    await conversations.useModel({ id, modelId: DEEP_ID });
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
    expect(
      (await store.readMessages(id)).flatMap((m) => ('content' in m ? [[m.role, m.content]] : [])),
    ).toEqual([
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
    expect(
      (await store.readMessages(id)).flatMap((m) => ('content' in m ? [m.content] : [])),
    ).toEqual(['first', 'one', 'second', 'two']);
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
    const id = conversationIdSchema.parse('00000000-0000-4000-8000-0000000000cc');
    const main = sessionIdSchema.parse('main');
    const asking: Message = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: callIdSchema.parse('b1'), name: 'block', input: {} }],
      at: 2,
    };

    await store.writeMessages({ id, messages: [{ role: 'user', content: 'go', at: 1 }, asking] });
    await store.writeIndex({ ...indexOf(id, 1), modelId: FAST_ID, updatedAt: 2 });
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

    await expect(
      conversations.reopen(conversationIdSchema.parse('00000000-0000-4000-8000-0000000000ff')),
    ).rejects.toMatchObject({
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
          run: twoModelRun(),
        };
      },
    });
    const id = await conversations.start();

    await collect((await conversations.send({ id, prompt: { text: 'hi' } })).events);

    expect(await conversations.listStored()).toEqual([]);
    await expect(conversations.reopen(id)).resolves.toBe(id);
  });

  describe('which workspace and profile a conversation is built on', () => {
    const REPO = '/work/repo';
    const OTHER = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b11');
    const KEPT = conversationIdSchema.parse('00000000-0000-4000-8000-0000000000dd');

    it('hands the app the id, workspace and profile a start asked for, and the id is the conversation’s', async () => {
      const { conversations, created } = setup({
        store: new MemoryConversationStore(),
        replies: [],
      });
      const id = await conversations.start({ workspace: REPO, profile: OTHER });

      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ id, workspace: REPO, profile: OTHER });
    });

    it('passes neither when the start named neither: the app decides what that means', async () => {
      const { conversations, created } = setup({
        store: new MemoryConversationStore(),
        replies: [],
      });

      await conversations.start();

      expect(created[0]?.workspace).toBeUndefined();
      expect(created[0]?.profile).toBeUndefined();
    });

    it('keeps in the index the workspace and profile the run reports, not what was asked', async () => {
      const store = new MemoryConversationStore();
      const { conversations } = setup({ store, replies: [] });
      const id = await conversations.start({ workspace: '/asked', profile: OTHER });

      await settled(conversations, id);

      // The fake's run reports its own: what the app made of the request is what is recorded.
      expect(await conversations.listStored()).toMatchObject([
        { id, workspace: '/work', profile: TEST_PROFILE_ID },
      ]);
    });

    it('reopens a conversation on the workspace and profile it was kept with', async () => {
      const store = new MemoryConversationStore();

      await store.writeIndex({ ...indexOf(KEPT, 1), workspace: REPO, profile: OTHER });
      await store.writeMessages({ id: KEPT, messages: [{ role: 'user', content: 'hi', at: 1 }] });

      const { conversations, created } = setup({ store, replies: [] });

      await conversations.reopen(KEPT);

      expect(created[0]).toMatchObject({ id: KEPT, workspace: REPO, profile: OTHER });
    });
  });

  describe('listing the stored of one workspace or profile', () => {
    const [A, B, C] = ['01', '02', '03'].map((n) =>
      conversationIdSchema.parse(`00000000-0000-4000-8000-0000000000${n}`),
    ) as [ConversationId, ConversationId, ConversationId];
    const WORK = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b11');
    const HOME = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b12');

    /** Three conversations: two in one repo (on different profiles), one in another repo. */
    async function threeKept() {
      const store = new MemoryConversationStore();

      await store.writeIndex({ ...indexOf(A, 1), workspace: '/a', profile: WORK });
      await store.writeIndex({ ...indexOf(B, 2), workspace: '/a', profile: HOME });
      await store.writeIndex({ ...indexOf(C, 3), workspace: '/b', profile: WORK });

      return setup({ store, replies: [] }).conversations;
    }

    const idsOf = async (
      conversations: Awaited<ReturnType<typeof threeKept>>,
      filter: { workspace?: string; profile?: string },
    ) => (await conversations.listStored(filter)).map((each) => each.id);

    it('lists every workspace’s and profile’s when asked for none', async () => {
      expect(await idsOf(await threeKept(), {})).toEqual([A, B, C]);
    });

    it('keeps only the workspace’s, only the profile’s, or both', async () => {
      const conversations = await threeKept();

      expect(await idsOf(conversations, { workspace: '/a' })).toEqual([A, B]);
      expect(await idsOf(conversations, { profile: WORK })).toEqual([A, C]);
      expect(await idsOf(conversations, { workspace: '/a', profile: WORK })).toEqual([A]);
      expect(await idsOf(conversations, { workspace: '/nowhere' })).toEqual([]);
    });

    it('does not take a path that merely starts with the workspace for the workspace', async () => {
      const conversations = await threeKept();

      expect(await idsOf(conversations, { workspace: '/' })).toEqual([]);
      expect(await idsOf(conversations, { workspace: '/a/' })).toEqual([]);
    });
  });

  describe('searching the stored', () => {
    const FIRST = conversationIdSchema.parse('00000000-0000-4000-8000-000000000001');
    const SECOND = conversationIdSchema.parse('00000000-0000-4000-8000-000000000002');

    async function twoTitled() {
      const store = new MemoryConversationStore();

      await store.writeIndex(indexOf(FIRST, 1, 'Fix the Login bug'));
      await store.writeIndex(indexOf(SECOND, 2, 'Add dark mode'));

      return setup({ store, replies: [] }).conversations;
    }

    it('lists those whose title has the search, ignoring case', async () => {
      const conversations = await twoTitled();

      expect((await conversations.listStored({ search: 'LOGIN' })).map((each) => each.id)).toEqual([
        FIRST,
      ]);
      expect((await conversations.listStored({ search: 'mode' })).map((each) => each.id)).toEqual([
        SECOND,
      ]);
    });

    it('lists every one without a search, and none when nothing matches', async () => {
      const conversations = await twoTitled();

      expect((await conversations.listStored()).map((each) => each.id)).toEqual([FIRST, SECOND]);
      expect(await conversations.listStored({ search: 'zzz' })).toEqual([]);
    });

    it('still marks a match whose process ended as interrupted', async () => {
      const conversations = await twoTitled();

      expect(await conversations.listStored({ search: 'login' })).toMatchObject([
        { id: FIRST, status: 'interrupted' },
      ]);
    });
  });
});
