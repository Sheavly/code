import { describe, expect, it } from 'vitest';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { ProviderSwitch } from '@sheavly/providers/switch/switch.service';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { createHarness } from '../../host/host.helper.js';
import { createConversation } from '../conversation.helper.js';

describe('conversation instructions', () => {
  it.each([undefined, '', 'COMPLETE OVERRIDE'])(
    'uses harness defaults only when the conversation override is absent: %s',
    async (instructions) => {
      const requests: ProviderRequest[] = [];
      const harness = createHarness({
        provider: scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]),
        title: 'hi',
        instructions: 'HOST',
        onModelCall: (request) => requests.push(request),
      });
      const conversation = createConversation({
        harness,
        run: streamAgent,
        tools: [],
        ...(instructions !== undefined && { instructions }),
      });

      await collect(conversation.send('hi'));
      await conversation.close();
      expect(requests[0]?.instructions ?? '').toBe(instructions ?? harness.instructions);
    },
  );

  it('keeps shared text stable across model switches and appends hook instructions last', async () => {
    const first: ProviderRequest[] = [];
    const second: ProviderRequest[] = [];
    const providers = new ProviderSwitch()
      .add('unknown-family', {
        stream(request) {
          first.push(request);

          return scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]).stream(request);
        },
      })
      .add('another-family', {
        stream(request) {
          second.push(request);

          return scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]).stream(request);
        },
      });
    const harness = createHarness({ provider: providers, title: 'hi', instructions: 'HOST' });
    const conversation = createConversation({
      harness,
      run: streamAgent,
      tools: [],
      hooks: [
        defineHook({
          name: 'extra-context',
          beforeTurn: async (context) => {
            context.addInstructions('HOOK');
          },
        }),
      ],
    });

    await collect(conversation.send('first'));
    providers.use('another-family');
    await collect(conversation.send('second'));
    await conversation.close();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.instructions).toBe(`${harness.instructions}\n\nHOOK`);
    expect(second[0]?.instructions).toBe(first[0]?.instructions);
  });
});
