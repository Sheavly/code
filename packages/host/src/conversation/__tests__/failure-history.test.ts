import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { createHarness } from '../../host/host.helper.js';
import { createConversation } from '../conversation.helper.js';

describe('failed conversation history', () => {
  it('keeps completed tool work and the user prompt, then continues from them', async () => {
    const calls: Message[][] = [];
    const kept: (readonly HistoryMessage[])[] = [];
    const harness = createHarness({
      title: 'Recovery',
      provider: {
        async *stream(request) {
          calls.push(request.messages);

          if (calls.length === 1) {
            yield toolCall({ id: 'edit-1', name: 'edit', input: {} });
            yield { type: 'done', stopReason: 'tool_use' };

            return;
          }

          if (calls.length === 2) throw new Error('Invalid thinking signature');

          yield { type: 'text_delta', text: 'Recovered' };
          yield { type: 'done', stopReason: 'end_turn' };
        },
      },
    });
    const conversation = createConversation({
      harness,
      run: streamAgent,
      tools: [],
      hooks: [
        defineHook({
          name: 'edit',
          aroundToolCall: async () => ({ content: 'edited', isError: false }),
        }),
      ],
      keepHistory: (messages) => {
        kept.push([...messages]);
      },
    });

    await expect(collect(conversation.send('Edit it'))).rejects.toThrow(
      'Invalid thinking signature',
    );

    expect(conversation.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
    ]);
    const last = conversation.messages.at(-1);

    expect(last?.role === 'tool' && last.content).toContain('edited');
    expect(kept.at(-1)).toEqual(conversation.messages);
    // The keeper fails storage on a shorter history, so none handed to it may be shorter.
    const sizes = kept.map((messages) => messages.length);

    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(conversation.running).toBe(false);

    await collect(conversation.send('Continue'));

    expect(calls[2]?.slice(0, 3)).toEqual(kept[1]);
    expect(conversation.messages.at(-1)).toMatchObject({ content: 'Recovered' });
  });

  it('keeps the prompt even when the provider fails before producing any output', async () => {
    const harness = createHarness({
      title: 'Early failure',
      provider: {
        stream: () => {
          throw new Error('Connection refused');
        },
      },
    });
    const conversation = createConversation({ harness, run: streamAgent, tools: [] });

    await expect(collect(conversation.send('Do not lose this'))).rejects.toThrow(
      'Connection refused',
    );

    expect(conversation.messages).toMatchObject([{ role: 'user', content: 'Do not lose this' }]);
    expect(conversation.running).toBe(false);
  });
});
