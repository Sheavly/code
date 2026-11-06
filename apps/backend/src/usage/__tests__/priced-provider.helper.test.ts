import { describe, expect, it } from 'vitest';
import { modelSchema } from '@sheavly/protocol/model/model.validator';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { pricedProvider } from '../priced-provider.helper.js';

describe('pricedProvider', () => {
  it('prices ordinary, cached and written input separately, without counting cache twice', async () => {
    const model = modelSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Model',
      adapter: 'openai',
      definition: {},
      pricing: { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 },
    });
    const provider = pricedProvider({
      model,
      provider: scriptedProvider([
        [
          {
            type: 'done',
            stopReason: 'end_turn',
            usage: {
              tokens: {
                inputTokens: 1_000_000,
                outputTokens: 100_000,
                cacheReadTokens: 500_000,
                cacheWriteTokens: 100_000,
              },
            },
          },
        ],
      ]),
    });
    const events = [];

    for await (const event of provider.stream({
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ usage: { modelId: model.id, estimatedCostUsd: 1.95 } });
  });

  it('does not invent usage or a zero price when a provider reports nothing', async () => {
    const model = modelSchema.parse({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Unknown',
      adapter: 'openai',
      definition: {},
    });
    const provider = pricedProvider({
      model,
      provider: scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]),
    });

    for await (const event of provider.stream({
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    })) {
      expect(event).toEqual({
        type: 'done',
        stopReason: 'end_turn',
        usage: { tokens: null, modelId: model.id },
      });
    }
  });
});
