import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { blockTool } from '@sheavly/runtime/testing/block-tool.fake';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import type { Message } from '@sheavly/protocol/message/message.types';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import { createConversation } from '../../conversation/conversation.helper.js';
import { createHarness } from '../../host/host.helper.js';
import { ConversationsError } from '../../errors/conversations.errors.js';
import { reviewSkill as skills } from '../../testing/skills.fake.js';
import { twoModelRun } from '../../testing/run.fake.js';
import { Conversations } from '../conversations.service.js';

const say = (text: string): StreamEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];

/** Conversations on a scripted model, each built like an app builds one. */
function setup(params: { replies: StreamEvent[][]; withSkills?: boolean }) {
  const sent: Message[][] = [];
  const disposed: string[] = [];
  const conversations = new Conversations({
    create: async ({ messages }) => {
      const scripted = scriptedProvider(params.replies);
      const harness = createHarness({
        provider: {
          stream: (request) => {
            sent.push(request.messages);

            return scripted.stream(request);
          },
        },
        title: 'Chat',
      });

      return {
        harness,
        conversation: createConversation({
          harness,
          run: streamAgent,
          tools: [blockTool],
          messages: messages ?? [],
        }),
        ...(params.withSkills && { skills }),
        run: twoModelRun(),
        dispose: async () => {
          disposed.push('disposed');
        },
      };
    },
  });

  return { conversations, sent, disposed };
}

describe('Conversations', () => {
  const clock = useFixedClock();

  it('keeps each conversation apart, each continuing its own history', async () => {
    const { conversations, sent } = setup({ replies: [say('one'), say('two')] });
    const a = await conversations.start();
    const b = await conversations.start({ messages: [{ role: 'user', content: 'earlier' }] });

    await collect((await conversations.send({ id: a, prompt: { text: 'hi a' } })).events);
    await collect((await conversations.send({ id: b, prompt: { text: 'hi b' } })).events);

    expect(a).not.toBe(b);
    expect(conversations.messages(a).map((m) => m.content)).toEqual(['hi a', 'one']);
    expect(sent.at(-1)?.map((m) => m.content)).toEqual(['earlier', 'hi b']);
  });

  it('lists every live conversation, oldest first, with whether a prompt runs', async () => {
    const { conversations } = setup({ replies: [say('one')] });
    const a = await conversations.start();
    const b = await conversations.start();
    const { events } = await conversations.send({ id: b, prompt: { text: 'go' } });

    expect(conversations.list()).toEqual([
      expect.objectContaining({ id: a, title: 'Chat', running: false }),
      expect.objectContaining({ id: b, title: 'Chat', running: true }),
    ]);
    await collect(events);
    await conversations.close(a);
    expect(conversations.list().map(({ id, running }) => ({ id, running }))).toEqual([
      { id: b, running: false },
    ]);
    expect(conversations.list()[0]?.session).toBe(conversations.get(b).harness.mainSession.id);
  });

  it('describes a conversation’s run, and switches its model to one it has', async () => {
    const { conversations } = setup({ replies: [] });
    const id = await conversations.start();

    expect(conversations.details(id)).toMatchObject({
      id,
      title: 'Chat',
      running: false,
      workspace: '/work',
      model: { name: 'fast' },
      models: [{ name: 'fast' }, { name: 'deep' }],
    });
    conversations.useModel({ id, name: 'deep' });
    expect(conversations.details(id).model).toEqual({
      name: 'deep',
      adapter: 'azure',
      model: 'gpt-5',
    });
    expect(() => conversations.useModel({ id, name: 'huge' })).toThrow(
      expect.objectContaining({ reason: 'unknown_model' }),
    );
  });

  it('runs a prompt’s skills, keeping what the user typed on the history', async () => {
    const { conversations, sent } = setup({ replies: [say('ok')], withSkills: true });
    const id = await conversations.start();
    const prompt = await conversations.send({ id, prompt: { text: 'look /review' } });

    await collect(prompt.events);

    expect(prompt.text).toBe('[review]\nlook /review');
    expect(sent[0]?.[0]).toMatchObject({
      role: 'user',
      content: '[review]\nlook /review',
      parts: [{ type: 'skill', name: 'review' }],
    });
    expect(await conversations.skills({ id })).toHaveLength(1);
    // A search narrows by name or description, ignoring case; one that matches nothing lists none.
    expect(await conversations.skills({ id, search: 'REV' })).toHaveLength(1);
    expect(await conversations.skills({ id, search: 'reviews' })).toHaveLength(1);
    expect(await conversations.skills({ id, search: 'deploy' })).toEqual([]);
  });

  it('refuses a picked skill no one has before the prompt starts', async () => {
    const { conversations, sent } = setup({ replies: [say('never')], withSkills: true });
    const id = await conversations.start();

    await expect(
      conversations.send({ id, prompt: { parts: [{ type: 'skill', name: 'nope' }] } }),
    ).rejects.toMatchObject({ reason: 'unknown_skill' });
    expect(sent).toEqual([]);
  });

  it('sends text as it is, and has no skills, when the conversation has none', async () => {
    const { conversations, sent } = setup({ replies: [say('ok')] });
    const id = await conversations.start();

    await collect((await conversations.send({ id, prompt: { text: 'plain /review' } })).events);

    expect(sent[0]?.[0]).toMatchObject({ role: 'user', content: 'plain /review' });
    expect(await conversations.skills({ id })).toEqual([]);
  });

  it('stamps the user’s prompt with when it was sent, and keeps it on the history', async () => {
    const { conversations } = setup({ replies: [say('ok')] });
    const id = await conversations.start();
    const sentAt = clock.at;

    clock.advance(2_000);
    await collect((await conversations.send({ id, prompt: { text: 'hello' } })).events);

    expect(conversations.messages(id)[0]).toMatchObject({
      role: 'user',
      content: 'hello',
      at: sentAt + 2_000,
    });
  });

  it('stops a running prompt and keeps history valid; refuses a second while one runs', async () => {
    const { conversations } = setup({
      replies: [
        [
          toolCall({ id: 'b1', name: 'block', input: {} }),
          { type: 'done', stopReason: 'tool_use' },
        ],
        say('next'),
      ],
    });
    const id = await conversations.start();
    const { events } = await conversations.send({ id, prompt: { text: 'wait' } });
    const seen: string[] = [];

    for await (const event of events) {
      seen.push(event.type);

      if (event.type === 'tool_call_started') {
        await expect(conversations.send({ id, prompt: { text: 'too soon' } })).rejects.toThrow(
          expect.objectContaining({ reason: 'session_running' }),
        );
        conversations.stop(id);
      }
    }

    expect(seen.at(-1)).toBe('done');
    expect(conversations.messages(id).map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('closes a conversation, disposing what the app opened, and forgets it', async () => {
    const { conversations, disposed } = setup({ replies: [say('ok')] });
    const id = await conversations.start();

    await conversations.close(id);

    expect(disposed).toEqual(['disposed']);
    expect(() => conversations.messages(id)).toThrow(ConversationsError);
    expect(() => conversations.get(conversationIdSchema.parse('nope'))).toThrow(
      expect.objectContaining({ reason: 'not_found' }),
    );
  });

  it('closes every conversation at once, for a host shutting down', async () => {
    const { conversations, disposed } = setup({ replies: [say('ok')] });

    await conversations.start();
    await conversations.start();
    await conversations.closeAll();

    expect(disposed).toEqual(['disposed', 'disposed']);
  });
});
