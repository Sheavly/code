import { describe, expect, it } from 'vitest';
import { DEFAULT_ADAPTER, DEFAULT_MODEL, REQUEST } from '../harness.constants.js';
import { parseProviderEnv, parseRequestEnv } from '../settings.validator.js';

describe('parseProviderEnv', () => {
  it("defaults to the hosts' adapter and model", () => {
    expect(parseProviderEnv({ OPENAI_API_KEY: 'sk-1' })).toEqual({
      ADAPTER: DEFAULT_ADAPTER,
      OPENAI_API_KEY: 'sk-1',
      MODEL: DEFAULT_MODEL,
    });
  });

  it('reads the azure settings, treating an empty api version as not set', () => {
    expect(
      parseProviderEnv({
        ADAPTER: 'azure',
        AZURE_OPENAI_API_KEY: 'az-1',
        AZURE_OPENAI_BASE_URL: 'https://res.openai.azure.com/openai/v1',
        AZURE_OPENAI_API_VERSION: '',
      }),
    ).toEqual({
      ADAPTER: 'azure',
      AZURE_OPENAI_API_KEY: 'az-1',
      AZURE_OPENAI_BASE_URL: 'https://res.openai.azure.com/openai/v1',
      AZURE_OPENAI_DEPLOYMENT: DEFAULT_MODEL,
      AZURE_OPENAI_API_VERSION: undefined,
    });
  });

  it('rejects a missing key, and names the key to set when it is empty', () => {
    expect(() => parseProviderEnv({})).toThrow('OPENAI_API_KEY');
    expect(() => parseProviderEnv({ ADAPTER: 'azure', AZURE_OPENAI_API_KEY: 'k' })).toThrow(
      'AZURE_OPENAI_BASE_URL',
    );
    expect(() => parseProviderEnv({ OPENAI_API_KEY: '' })).toThrow('Set OPENAI_API_KEY');
  });

  it('rejects an adapter it does not know', () => {
    expect(() => parseProviderEnv({ ADAPTER: 'astra', OPENAI_API_KEY: 'sk-1' })).toThrow();
  });
});

describe('parseRequestEnv', () => {
  it("defaults to the terminal's policy, and reads each setting from env", () => {
    expect(parseRequestEnv({})).toEqual(REQUEST);
    expect(
      parseRequestEnv({
        MODEL_RESPONSE_TIMEOUT_MS: '5000',
        MODEL_RETRIES: '0',
        MODEL_RETRY_DELAY_MS: '',
      }),
    ).toEqual({ responseTimeoutMs: 5000, retries: 0, retryDelayMs: REQUEST.retryDelayMs });
  });

  it('rejects a value that is not a whole number, and a timeout of zero', () => {
    expect(() => parseRequestEnv({ MODEL_RETRIES: 'two' })).toThrow();
    expect(() => parseRequestEnv({ MODEL_RETRIES: '1.5' })).toThrow();
    expect(() => parseRequestEnv({ MODEL_RETRIES: '11' })).toThrow(
      'Set MODEL_RETRIES to at most 10',
    );
    expect(() => parseRequestEnv({ MODEL_RESPONSE_TIMEOUT_MS: '0' })).toThrow();
  });
});
