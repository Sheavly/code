import { describe, expect, it } from 'vitest';
import { REQUEST, SERVER } from '../harness.constants.js';
import { parseRequestEnv, parseRunEnv, parseServerEnv } from '../settings.validator.js';

describe('parseServerEnv', () => {
  it('listens on localhost by default, and on a free port with SERVER_PORT=0', () => {
    expect(parseServerEnv({})).toEqual({
      host: SERVER.host,
      port: SERVER.port,
      token: undefined,
      remoteSetupAllowed: true,
    });
    expect(parseServerEnv({ SERVER_PORT: '0' }).port).toBe(0);
  });

  it('refuses a short token and a port past the range', () => {
    expect(() => parseServerEnv({ SERVER_TOKEN: 'short' })).toThrow('at least 32');
    expect(() => parseServerEnv({ SERVER_PORT: '70000' })).toThrow();
  });

  it('takes setup that hands out access where only this machine can reach, and nowhere else unless opted in', () => {
    const takes = (env: Record<string, string>) => parseServerEnv(env).remoteSetupAllowed;

    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', '::1']) {
      expect(takes({ SERVER_HOST: host }), host).toBe(true);
    }

    // Every interface, or a LAN address, or a name: a key must not travel there.
    for (const host of ['0.0.0.0', '::', '192.168.1.5', 'example.com', '127.0.0.1.evil.com']) {
      expect(takes({ SERVER_HOST: host }), host).toBe(false);
    }
  });

  it('lets a remote host take setup that hands out access only on the exact word "true"', () => {
    const env = { SERVER_HOST: '0.0.0.0' };

    expect(parseServerEnv({ ...env, SERVER_ALLOW_REMOTE_SETUP: 'true' }).remoteSetupAllowed).toBe(
      true,
    );

    for (const word of ['TRUE', '1', 'yes', 'false', '']) {
      expect(
        parseServerEnv({ ...env, SERVER_ALLOW_REMOTE_SETUP: word }).remoteSetupAllowed,
        word,
      ).toBe(false);
    }
  });
});

describe('parseRunEnv', () => {
  it('reads the run limits and files, with every switch off unless exactly "true"', () => {
    expect(parseRunEnv({})).toEqual({
      maxTurns: undefined,
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
    expect(parseRunEnv({ MAX_TURNS: '' }).maxTurns).toBeUndefined();
    expect(() => parseRunEnv({ MAX_TURNS: '0' })).toThrow();
  });
});

describe('parseRequestEnv', () => {
  it("defaults to the backend's policy, and reads each setting from env", () => {
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
