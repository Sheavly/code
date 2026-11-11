import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { createHarness } from '../../host/host.helper.js';
import { createConversation } from '../conversation.helper.js';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { MemoryConversationStore } from '@sheavly/testing/store/memory-store.fake';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { say, scriptedConversations as setup } from '../../testing/conversations.fake.js';

const blocked = [
  toolCall({ id: 'b1', name: 'block', input: {} }),
  { type: 'done' as const, stopReason: 'tool_use' as const },
];

describe('conversation follow-up acceptance', () => {
  it('refuses idle and closed conversations, but accepts before the active iterator starts', async () => {
    const { conversations } = setup({ replies: [say('ok')] });
    const id = await conversations.start();
    const { conversation } = conversations.get(id);

    expect(conversation.followup('idle')).toBe(false);
    const sent = await conversations.send({ id, prompt: { text: 'first' } });

    expect(conversation.followup('second')).toBe(true);
    await collect(sent.events);
    expect(conversation.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'first',
      'second',
    ]);
    expect(conversation.followup('idle again')).toBe(false);
    await conversations.close(id);
    expect(() => conversation.followup('closed')).toThrow(
      expect.objectContaining({ reason: 'session_ended' }),
    );
  });

  it('closes intake before done is observed even while the iterator still reports running', async () => {
    const { conversations } = setup({ replies: [say('finished')] });
    const id = await conversations.start();
    const { conversation, harness } = conversations.get(id);
    const idle: boolean[] = [];
    const stopListening = harness.sessions.subscribe((update) => {
      if (update.type !== 'session_idle') return;
      expect(conversation.running).toBe(true);
      idle.push(conversation.followup('during completion'));
    });

    try {
      const sent = await conversations.send({ id, prompt: { text: 'first' } });

      for await (const event of sent.events) {
        if (event.type !== 'done') continue;
        expect(conversation.running).toBe(true);
        expect(conversation.followup('after done')).toBe(false);
      }

      expect(idle).toEqual([false]);
      expect(harness.sessions.hasMessages(harness.mainSession.id)).toBe(false);
    } finally {
      stopListening();
      await conversations.close(id);
    }
  });

  it('keeps accepted steering once when abort prevents delivery and rejects subsequent steering', async () => {
    const store = new MemoryConversationStore();
    const { conversations } = setup({ replies: [blocked, say('continued')], store });
    const id = await conversations.start();
    const { conversation, harness } = conversations.get(id);
    const sent = await conversations.send({ id, prompt: { text: 'wait' } });

    try {
      for await (const event of sent.events) {
        if (event.type !== 'tool_call_started') continue;
        expect(conversation.followup('Keep this request.')).toBe(true);
        conversations.stop(id);
        expect(conversation.followup('too late')).toBe(false);
        expect(await conversations.followup({ id, prompt: { text: 'also too late' } })).toBe(false);
      }

      expect(harness.sessions.hasMessages(harness.mainSession.id)).toBe(false);
      expect(conversation.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
        'wait',
        'Keep this request.',
      ]);
      await collect((await conversations.send({ id, prompt: { text: 'continue' } })).events);
      await conversations.close(id);
      expect(
        (await store.readMessages(id)).filter((m) => m.role === 'user').map((m) => m.content),
      ).toEqual(['wait', 'Keep this request.', 'continue']);
    } finally {
      if (conversations.list().some((live) => live.id === id)) await conversations.close(id);
    }
  });

  it('keeps accepted steering once when a turn limit prevents another model call', async () => {
    let kept: readonly HistoryMessage[] = [];
    const harness = createHarness({
      title: 'Capped',
      provider: scriptedProvider([
        [
          toolCall({ id: 'e1', name: 'echo', input: { text: 'work' } }),
          { type: 'done', stopReason: 'tool_use' },
        ],
      ]),
    });
    const conversation = createConversation({
      harness,
      run: streamAgent,
      tools: [
        defineTool({
          name: 'echo',
          description: 'Complete finite work',
          inputSchema: z.object({ text: z.string() }),
          execute: async ({ input }) => input.text,
        }),
      ],
      maxTurns: 1,
      keepHistory: (history) => {
        kept = history;
      },
    });
    const received: string[] = [];

    try {
      for await (const event of conversation.send('first')) {
        if (event.type === 'tool_call_started') {
          expect(conversation.followup('next request')).toBe(true);
        }

        if (event.type === 'message_received') received.push(event.message.content);

        if (event.type === 'done') {
          expect(event.reason).toBe('max_turns');
          expect(conversation.followup('after limit')).toBe(false);
        }
      }

      expect(received).toEqual([]);
      expect(kept.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
        'first',
        'next request',
      ]);
      expect(harness.sessions.hasMessages(harness.mainSession.id)).toBe(false);
    } finally {
      await conversation.close();
    }
  });

  it('keeps accepted steering before its first model call is aborted', async () => {
    const { conversations } = setup({ replies: [say('unused')] });
    const id = await conversations.start();
    const stop = new AbortController();
    const sent = await conversations.send({ id, prompt: { text: 'first' }, signal: stop.signal });
    const { conversation } = conversations.get(id);

    expect(conversation.followup('accepted')).toBe(true);
    stop.abort();
    expect(conversation.followup('rejected')).toBe(false);
    await collect(sent.events);
    expect(conversation.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'first',
      'accepted',
    ]);
    await conversations.close(id);
  });
});
