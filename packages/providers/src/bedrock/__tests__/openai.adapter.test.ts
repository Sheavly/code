import { describe, expect, it } from 'vitest';
import { requestSentBy } from '@sheavly/testing/fetch/fake-fetch.fake';
import { bedrockOpenaiAdapter } from '../openai.adapter.js';
import { TEST_REQUEST } from '../../testing/request.constants.js';

const base = {
  auth: 'api-key',
  apiKey: 'bk-secret',
  region: 'us-west-2',
  model: 'global.openai.gpt-6-astra',
  request: TEST_REQUEST,
};
const parse = (config: object) =>
  bedrockOpenaiAdapter.configSchema.safeParse({ ...base, ...config });
const sent = (config: object = {}) =>
  requestSentBy({ adapter: bedrockOpenaiAdapter, config: { ...base, ...config } });

describe('bedrockOpenaiAdapter', () => {
  it('sends the Responses call to the region’s bedrock-runtime, with a Bearer key and the profile', async () => {
    const request = await sent();

    expect(request?.url).toBe(
      'https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1/responses',
    );
    expect(request?.headers.authorization).toBe('Bearer bk-secret');
    expect(request?.body.model).toBe('global.openai.gpt-6-astra');
  });

  it('runs stateless and keeps the key out of the request body', async () => {
    const request = await sent();

    expect(request?.body.store).toBe(false);
    expect(JSON.stringify(request?.body)).not.toContain('bk-secret');
  });

  it('caches history with explicit breakpoints by default, and not when turned off', async () => {
    expect((await sent())?.body.prompt_cache_options).toEqual({ mode: 'explicit' });
    expect((await sent({ explicitCache: false }))?.body).not.toHaveProperty('prompt_cache_options');
  });

  it.each(['us.openai.gpt-6-luna', 'global.openai.gpt-6.1-sol', 'us-gov.openai.gpt-6-astra'])(
    'accepts the inference profile %s',
    (model) => {
      expect(parse({ model }).success).toBe(true);
    },
  );

  it.each([
    ['a bare model ID: GPT cannot be called in-Region on bedrock-runtime', 'openai.gpt-6-astra'],
    ['a profile of another provider', 'us.anthropic.claude-sonnet-5-5'],
    ['an unknown prefix', 'mars.openai.gpt-6-astra'],
  ])('refuses %s', (_name, model) => {
    expect(parse({ model }).success).toBe(false);
  });

  it.each(['evil.example.com/', 'us-east-1.evil.com', 'US-EAST-1', ''])(
    'refuses the region %j, so the host cannot be steered elsewhere',
    (region) => {
      expect(parse({ region }).success).toBe(false);
    },
  );
});
