import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADAPTER,
  DEFAULT_MODEL,
  MAX_TURNS,
  REQUEST,
  SERVER,
} from '../harness.constants.js';
import {
  parseProviderEnv,
  parseRequestEnv,
  parseRunEnv,
  parseServerEnv,
} from '../settings.validator.js';

describe('parseServerEnv', () => {
  it('listens on localhost by default, and on a free port with SERVER_PORT=0', () => {
    expect(parseServerEnv({})).toEqual({ host: SERVER.host, port: SERVER.port, token: undefined });
    expect(parseServerEnv({ SERVER_PORT: '0' }).port).toBe(0);
  });

  it('refuses a short token and a port past the range', () => {
    expect(() => parseServerEnv({ SERVER_TOKEN: 'short' })).toThrow('at least 32');
    expect(() => parseServerEnv({ SERVER_PORT: '70000' })).toThrow();
  });
});

describe('parseRunEnv', () => {
  it('reads the run limits and files, with every switch off unless exactly "true"', () => {
    expect(parseRunEnv({})).toEqual({
      maxTurns: MAX_TURNS,
      waitForTasks: false,
      modelCallsFile: undefined,
      exitWithParent: false,
    });
    expect(
      parseRunEnv({
        MAX_TURNS: '5',
        WAIT_FOR_TASKS: 'true',
        MODEL_CALLS_FILE: '/tmp/calls.jsonl',
        SERVER_EXIT_WITH_PARENT: 'yes',
      }),
    ).toEqual({
      maxTurns: 5,
      waitForTasks: true,
      modelCallsFile: '/tmp/calls.jsonl',
      exitWithParent: false,
    });
    expect(() => parseRunEnv({ MAX_TURNS: '0' })).toThrow();
  });
});

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
