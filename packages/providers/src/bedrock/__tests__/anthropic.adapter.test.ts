import { describe, expect, it } from 'vitest';
import { requestSentBy } from '@sheavly/testing/fetch/fake-fetch.fake';
import { bedrockAnthropicAdapter } from '../anthropic.adapter.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';

const base = {
  apiKey: 'bk-secret',
  region: 'us-east-1',
  model: 'us.anthropic.claude-sonnet-5-5',
  maxTokens: 8192,
  request: TEST_REQUEST,
};
const parse = (config: object) =>
  bedrockAnthropicAdapter.configSchema.safeParse({ ...base, ...config });
const sent = (config: object = {}) =>
  requestSentBy({
    adapter: bedrockAnthropicAdapter,
    config: { ...base, ...config },
    reply: [{ type: 'message_stop' }],
  });

describe('bedrockAnthropicAdapter', () => {
  it('sends the Messages call to the region’s bedrock-runtime, with the key and the profile', async () => {
    const request = await sent({ region: 'eu-west-1', model: 'eu.anthropic.claude-opus-5-5' });

    expect(request?.url).toBe(
      'https://bedrock-runtime.eu-west-1.amazonaws.com/anthropic/v1/messages',
    );
    expect(request?.headers['x-api-key']).toBe('bk-secret');
    expect(request?.headers['anthropic-version']).toBe('2023-06-01');
    expect(request?.body).toMatchObject({
      model: 'eu.anthropic.claude-opus-5-5',
      max_tokens: 8192,
    });
  });

  it('keeps the key out of the request body', async () => {
    expect(JSON.stringify((await sent())?.body)).not.toContain('bk-secret');
  });

  it.each(['us-east-1', 'eu-central-2', 'ap-southeast-4', 'us-gov-west-1'])(
    'accepts the region %s',
    (region) => {
      expect(parse({ region }).success).toBe(true);
    },
  );

  it.each([
    'evil.example.com/',
    'us-east-1.evil.com',
    'US-EAST-1',
    'us_east_1',
    'us-east-1/../x',
    '',
  ])('refuses the region %j, so the host cannot be steered elsewhere', (region) => {
    expect(parse({ region }).success).toBe(false);
  });

  it.each([
    'us.anthropic.claude-sonnet-5-5',
    'eu.anthropic.claude-opus-5-5',
    'global.anthropic.claude-sonnet-5-5',
    'au.anthropic.claude-sonnet-5-5',
  ])('accepts the inference profile %s', (model) => {
    expect(parse({ model }).success).toBe(true);
  });

  it.each([
    ['a bare model ID', 'anthropic.claude-sonnet-5-5'],
    ['a profile of another provider', 'us.openai.gpt-6-astra'],
    ['an unknown prefix', 'mars.anthropic.claude-sonnet-5-5'],
    ['a profile without a model', 'us.anthropic.'],
    ['an empty value', ''],
  ])('refuses %s', (_name, model) => {
    expect(parse({ model }).success).toBe(false);
  });

  it('requires maxTokens: Bedrock reserves it from the quota on every call, so it has no default', () => {
    const { maxTokens: _omitted, ...withoutMax } = base;

    expect(bedrockAnthropicAdapter.configSchema.safeParse(withoutMax).success).toBe(false);
    expect(parse({ maxTokens: 0 }).success).toBe(false);
  });

  it('judges a thinking budget against the explicit maxTokens', () => {
    expect(parse({ thinkingMode: 'enabled', thinkingBudget: 2048 }).success).toBe(true);
    expect(parse({ thinkingMode: 'enabled', thinkingBudget: 8192 }).success).toBe(false);
    expect(parse({ thinkingMode: 'enabled' }).success).toBe(false);
    expect(parse({ thinkingMode: 'adaptive', thinkingBudget: 2048 }).success).toBe(false);
  });

  it('sends adaptive thinking without a budget, and cache_control unless turned off', async () => {
    const adaptive = await sent({ thinkingMode: 'adaptive' });
    const off = await sent({ promptCaching: false });

    expect(adaptive?.body.thinking).toEqual({ type: 'adaptive' });
    expect(adaptive?.body.cache_control).toEqual({ type: 'ephemeral' });
    expect(off?.body).not.toHaveProperty('cache_control');
  });

  it('is described with the key as its secret and the profile as the provider’s model', () => {
    expect(bedrockAnthropicAdapter.remoteField).toBe('model');
    expect(bedrockAnthropicAdapter.kind).toBe('bedrock-anthropic');
  });
});
