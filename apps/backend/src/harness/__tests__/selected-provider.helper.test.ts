import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import type { Provider, ProviderRequest } from '@sheavly/core/provider/provider.types';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { ProviderSwitch } from '@sheavly/providers/switch/switch.service';
import { selectedProvider } from '../selected-provider.helper.js';

it('a sub-agent captures the model and mode at start, including in its logged calls', async () => {
  const id = modelIdSchema.parse('11111111-1111-4111-8111-111111111111');
  const called: ProviderRequest[] = [];
  const logged: ProviderRequest[] = [];
  const provider: Provider = {
    async *stream(request) {
      called.push(request);
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
  const active = new ProviderSwitch().add(id, provider);

  active.setMode({ name: id, mode: 'high' });
  const pinned = selectedProvider({
    models: { switch: active, choices: [{ id, name: 'A', adapter: 'openai', model: 'a' }] },
    onModelCall: (request) => logged.push(request),
  });

  active.setMode({ name: id, mode: 'low' });
  await collect(
    pinned.provider.stream({ messages: [], tools: [], signal: new AbortController().signal }),
  );
  expect(pinned.selection).toEqual({ modelId: id, mode: 'high' });
  expect(called[0]?.mode).toBe('high');
  expect(logged[0]?.mode).toBe('high');
});

describe('selectedProvider', () => {
  it('refuses a missing selection', () => {
    expect(() =>
      selectedProvider({
        models: { switch: new ProviderSwitch(), choices: [] },
        onModelCall: undefined,
      }),
    ).toThrow('No model is selected');
  });
});
