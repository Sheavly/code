import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_WINDOW } from '@sheavly/protocol/model/model.constants';
import { modelSchema } from '@sheavly/protocol/model/model.validator';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { withContextWindow } from '../context-window.helper.js';

const modelWith = (extra: Record<string, unknown>) =>
  modelSchema.parse({
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Model',
    adapter: 'openai',
    definition: {},
    ...extra,
  });
const inner = () => scriptedProvider([[{ type: 'done', stopReason: 'end_turn' }]]);

describe('withContextWindow', () => {
  it('uses 300K for a model that sets none, whatever the model is', () => {
    const provider = withContextWindow({ provider: inner(), model: modelWith({}) });

    expect(DEFAULT_CONTEXT_WINDOW).toBe(300_000);
    expect(provider.contextWindow).toBe(300_000);
  });

  it('lets a model’s file switch to the full 1M window', () => {
    const provider = withContextWindow({
      provider: inner(),
      model: modelWith({ contextWindow: 1_000_000 }),
    });

    expect(provider.contextWindow).toBe(1_000_000);
  });

  it('keeps a size that is neither of the two a UI offers, since a model can have its own', () => {
    const provider = withContextWindow({
      provider: inner(),
      model: modelWith({ contextWindow: 128_000 }),
    });

    expect(provider.contextWindow).toBe(128_000);
  });

  it('lets the backend’s CONTEXT_WINDOW win over the file and the default', () => {
    const model = modelWith({ contextWindow: 1_000_000 });
    const windowOf = (params: { model: ReturnType<typeof modelWith>; override?: number }) =>
      withContextWindow({ provider: inner(), ...params }).contextWindow;

    expect(windowOf({ model, override: 24_000 })).toBe(24_000);
    expect(windowOf({ model: modelWith({}), override: 24_000 })).toBe(24_000);
    expect(windowOf({ model })).toBe(1_000_000);
  });

  it('streams exactly what the provider it wraps streams', async () => {
    const provider = withContextWindow({ provider: inner(), model: modelWith({}) });
    const request = { messages: [], tools: [], signal: new AbortController().signal };

    expect(await collect(provider.stream(request))).toEqual([
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });
});
