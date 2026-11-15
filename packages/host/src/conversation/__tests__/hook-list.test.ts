import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { createHarness } from '../../host/host.helper.js';
import { createConversation } from '../conversation.helper.js';
import type { RunPrompt } from '../conversation.types.js';

describe('the hook list a conversation hands the loop', () => {
  it('is the user’s list as given, with nothing injected, and the harness approvals', async () => {
    const received: Parameters<RunPrompt>[0][] = [];
    const harness = createHarness({
      title: 'Hooks',
      provider: {
        async *stream() {
          yield { type: 'text_delta', text: 'ok' };
          yield { type: 'done', stopReason: 'end_turn' };
        },
      },
    });
    const hooks = [defineHook({ name: 'mine', afterTurn: async () => undefined })];
    const conversation = createConversation({
      harness,
      run: (options) => {
        received.push(options);

        return streamAgent(options);
      },
      tools: [],
      hooks,
    });

    await collect(conversation.send('hi'));
    await collect(conversation.send('again'));

    expect(received).toHaveLength(2);

    for (const options of received) {
      expect(options.hooks).toEqual(hooks);
      expect(options.hooks.map((hook) => hook.name)).toEqual(['mine']);
      expect(options.approvals).toBe(harness.approvals);
    }
  });
});
