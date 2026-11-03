import { describe, expect, it } from 'vitest';
import { CLAUDE_MAX_TOKENS } from '../harness.constants.js';
import { parseModelsEnv } from '../models.validator.js';
import { providerFromEnv } from '../settings.helper.js';

const MODELS_ENV = {
  MODELS: 'gpt, claude, deepseek-flash',
  GPT_ADAPTER: 'azure',
  GPT_API_KEY: 'k1',
  GPT_BASE_URL: 'https://res.openai.azure.com/openai/v1',
  GPT_DEPLOYMENT: 'gpt-6.1-sol',
  CLAUDE_ADAPTER: 'azure-anthropic',
  CLAUDE_API_KEY: 'k2',
  CLAUDE_BASE_URL: 'https://res.services.ai.azure.com/anthropic',
  CLAUDE_DEPLOYMENT: 'claude-sonnet',
  CLAUDE_THINKING_BUDGET: '4096',
  DEEPSEEK_FLASH_ADAPTER: 'azure',
  DEEPSEEK_FLASH_API_KEY: 'k3',
  DEEPSEEK_FLASH_BASE_URL: 'https://other.services.ai.azure.com/openai/v1',
  DEEPSEEK_FLASH_DEPLOYMENT: 'DeepSeek-V4-Flash',
  DEEPSEEK_FLASH_REASONING: 'false',
};

describe('parseModelsEnv', () => {
  it('is undefined without MODELS, so the single ADAPTER is used', () => {
    expect(parseModelsEnv({})).toBeUndefined();
    expect(parseModelsEnv({ MODELS: '' })).toBeUndefined();
  });

  it("reads each model's keys from its name, with the defaults filled in", () => {
    expect(parseModelsEnv(MODELS_ENV)).toEqual([
      {
        name: 'gpt',
        settings: {
          ADAPTER: 'azure',
          API_KEY: 'k1',
          BASE_URL: 'https://res.openai.azure.com/openai/v1',
          DEPLOYMENT: 'gpt-6.1-sol',
          API_VERSION: undefined,
          REASONING: true,
        },
      },
      {
        name: 'claude',
        settings: {
          ADAPTER: 'azure-anthropic',
          API_KEY: 'k2',
          BASE_URL: 'https://res.services.ai.azure.com/anthropic',
          DEPLOYMENT: 'claude-sonnet',
          MAX_TOKENS: CLAUDE_MAX_TOKENS,
          THINKING_BUDGET: 4096,
        },
      },
      {
        name: 'deepseek-flash',
        settings: {
          ADAPTER: 'azure',
          API_KEY: 'k3',
          BASE_URL: 'https://other.services.ai.azure.com/openai/v1',
          DEPLOYMENT: 'DeepSeek-V4-Flash',
          API_VERSION: undefined,
          REASONING: false,
        },
      },
    ]);
  });

  it('names the key to set when one is missing or wrong', () => {
    expect(() => parseModelsEnv({ ...MODELS_ENV, CLAUDE_API_KEY: '' })).toThrow(
      'Set CLAUDE_API_KEY',
    );
    expect(() => parseModelsEnv({ ...MODELS_ENV, GPT_ADAPTER: 'openai' })).toThrow(
      'Set GPT_ADAPTER to azure or azure-anthropic',
    );
    expect(() => parseModelsEnv({ ...MODELS_ENV, CLAUDE_MAX_TOKENS: 'lots' })).toThrow(
      'Set CLAUDE_MAX_TOKENS to a whole number',
    );
    expect(() => parseModelsEnv({ ...MODELS_ENV, GPT_REASONING: 'yes' })).toThrow(
      'Set GPT_REASONING to true or false',
    );
  });

  it('rejects a name listed twice or one that is not lowercase', () => {
    expect(() => parseModelsEnv({ ...MODELS_ENV, MODELS: 'gpt,gpt' })).toThrow('listed twice');
    expect(() => parseModelsEnv({ ...MODELS_ENV, MODELS: 'GPT' })).toThrow('lowercase');
  });
});

describe('providerFromEnv with MODELS', () => {
  it('starts on the first model, behind a switch that can change to the others', () => {
    const settings = providerFromEnv(MODELS_ENV);

    expect(settings).toMatchObject({ adapter: 'azure', model: 'gpt-6.1-sol' });
    expect(settings.provider).toBe(settings.models?.switch);
    expect(settings.models?.switch.names()).toEqual(['gpt', 'claude', 'deepseek-flash']);
    expect(settings.models?.choices[1]).toEqual({
      name: 'claude',
      adapter: 'azure-anthropic',
      model: 'claude-sonnet',
    });
  });

  it("fails on a model the adapter rejects, naming the adapter's config", () => {
    expect(() => providerFromEnv({ ...MODELS_ENV, CLAUDE_THINKING_BUDGET: '20000' })).toThrow(
      'Invalid config for azure-anthropic',
    );
  });
});
