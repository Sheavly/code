import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { chatCall, chatFrame, chatTransport } from '../../testing/chat-completions.fake.js';

const efforts = ['low', 'medium', 'high', 'extreme'] as const;

describe('explicit Chat effort profiles', () => {
  it.each([
    [undefined, ['low', 'medium', 'high', 'xhigh']],
    ['openai', ['low', 'medium', 'high', 'xhigh']],
    ['deepseek', ['low', 'high', 'high', 'max']],
  ] as const)('maps every loop effort using profile %s', async (effortProfile, expected) => {
    const { provider, requests } = chatTransport({
      responses: efforts.map(() => [chatFrame({ finish: 'stop' })]),
      config: { effortProfile, thinkingMode: 'enabled' },
    });

    for (const effort of efforts) {
      await collect(provider.stream(chatCall({ effort })));
    }

    expect(requests.map(({ body }) => body.reasoning_effort)).toEqual(expected);

    for (const { body } of requests) {
      expect(body.thinking).toEqual({ type: 'enabled' });
      expect(body).not.toHaveProperty('effortProfile');
    }
  });

  it('never infers a profile from a DeepSeek deployment name', async () => {
    const { provider, requests } = chatTransport({
      responses: [[chatFrame({ finish: 'stop' })]],
      config: {
        endpoint: {
          url: 'https://other.test/models/chat/completions',
          model: 'DeepSeek-V4.1-Flash-1017',
          headers: {},
        },
      },
    });

    await collect(provider.stream(chatCall({ effort: 'extreme' })));
    expect(requests[0]?.body.reasoning_effort).toBe('xhigh');
    expect(requests[0]?.body).not.toHaveProperty('thinking');
  });

  it.each(['openai', 'deepseek'] as const)(
    'disabled thinking suppresses effort for %s; missing effort never invents effort',
    async (effortProfile) => {
      const disabled = chatTransport({
        responses: efforts.map(() => [chatFrame({ finish: 'stop' })]),
        config: { effortProfile, thinkingMode: 'disabled' },
      });

      for (const effort of efforts) {
        await collect(disabled.provider.stream(chatCall({ effort })));
      }

      for (const { body } of disabled.requests) {
        expect(body.thinking).toEqual({ type: 'disabled' });
        expect(body).not.toHaveProperty('reasoning_effort');
      }

      const unspecified = chatTransport({
        responses: [[chatFrame({ finish: 'stop' })]],
        config: { effortProfile, thinkingMode: 'enabled' },
      });

      await collect(unspecified.provider.stream(chatCall()));
      expect(unspecified.requests[0]?.body).not.toHaveProperty('reasoning_effort');
    },
  );
});
