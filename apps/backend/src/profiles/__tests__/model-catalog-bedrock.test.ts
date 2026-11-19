import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { assertModelHosting, setupModelCatalog } from '../model-catalog.helper.js';

const adapters = createDefaultRegistry().describe();
const hostsOf = (model: string) =>
  setupModelCatalog(adapters).find((entry) => entry.identity.model === model)?.hosts ?? [];
const bedrockOf = (model: string) =>
  hostsOf(model).find(({ adapter }) => adapter.startsWith('bedrock-'));

describe('the catalogue’s AWS Bedrock route', () => {
  it.each([
    ['claude-opus-5-5', 'bedrock-anthropic'],
    ['claude-sonnet-5-5', 'bedrock-anthropic'],
    ['gpt-6.1-sol', 'bedrock-openai'],
    ['gpt-6-astra', 'bedrock-openai'],
    ['gpt-6-luna', 'bedrock-openai'],
  ])('offers %s on %s', (model, adapter) => {
    expect(bedrockOf(model)).toMatchObject({ adapter, name: 'AWS Bedrock' });
  });

  it('offers no Bedrock route for DeepSeek, which Bedrock does not serve', () => {
    expect(bedrockOf('deepseek-v4-flash')).toBeUndefined();
    expect(bedrockOf('DeepSeek-V4.1-Flash-1017')).toBeUndefined();
  });

  it('leaves the inference profile, and so its prefix, to the person: nothing is filled in or fixed', () => {
    for (const model of ['claude-opus-5-5', 'gpt-6-astra']) {
      const host = bedrockOf(model);

      expect(host?.defaults).not.toHaveProperty('model');
      expect(host?.fixed).toEqual({});
    }
  });

  it('starts Claude on adaptive thinking, as on Azure', () => {
    expect(bedrockOf('claude-sonnet-5-5')?.defaults).toEqual({ thinkingMode: 'adaptive' });
  });

  it('is not advertised when the backend has no Bedrock adapter', () => {
    const withoutBedrock = adapters.filter(({ kind }) => !kind.startsWith('bedrock-'));
    const hosts = setupModelCatalog(withoutBedrock).flatMap((entry) => entry.hosts);

    expect(hosts.some(({ adapter }) => adapter.startsWith('bedrock-'))).toBe(false);
  });
});

describe('a Bedrock model of a known identity', () => {
  const model = {
    name: 'Opus',
    adapter: 'bedrock-anthropic',
    identity: { model: 'claude-opus-5-5', family: 'claude' },
  };
  const withProfile = (profile: string, overrides: object = {}) => ({
    ...model,
    ...overrides,
    definition: { region: 'us-east-1', model: profile },
  });

  it.each([
    'us.anthropic.claude-opus-5-5',
    'EU.anthropic.claude-opus-5-5',
    'global.anthropic.claude-opus-5-5',
  ])('accepts its own inference profile %s, whatever the prefix', (profile) => {
    expect(() => assertModelHosting({ adapters, model: withProfile(profile) })).not.toThrow();
  });

  it.each([
    ['another model’s profile', 'us.anthropic.claude-sonnet-5-5'],
    ['a profile of another owner', 'us.openai.claude-opus-5-5'],
    ['a bare model ID', 'anthropic.claude-opus-5-5'],
    ['no profile', ''],
  ])('refuses %s, so a known model is not paired with a different one', (_name, profile) => {
    expect(() => assertModelHosting({ adapters, model: withProfile(profile) })).toThrow(
      'Use an inference profile for claude-opus-5-5',
    );
  });

  it('refuses a GPT model on the Claude route and a Claude model on the GPT route', () => {
    for (const [adapter, identity] of [
      ['bedrock-anthropic', { model: 'gpt-6-astra', family: 'gpt' }],
      ['bedrock-openai', { model: 'claude-opus-5-5', family: 'claude' }],
    ] as const) {
      expect(() =>
        assertModelHosting({
          adapters,
          model: { name: 'x', adapter, identity, definition: { model: 'us.x.y' } },
        }),
      ).toThrow('does not support');
    }
  });
});
