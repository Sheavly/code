import { afterEach, describe, expect, it } from 'vitest';
import { instanceIdSchema } from '@sheavly/protocol/handshake/handshake.validator';
import {
  AnswerTooLargeError,
  EmptyTokenError,
  RedirectedError,
  VerifyTimeoutError,
} from '../../errors/client.errors.js';
import { recordingFetch } from '../../testing/handshake-server.fake.js';
import { startImpostor, streamHugeBody } from '../../testing/impostor-server.fake.js';
import type { Impostor } from '../../testing/testing.types.js';
import { createPublicClient } from '../client.helper.js';
import { verifyServer } from '../verify.helper.js';

const TOKEN = 'a-secret-token-that-must-never-leave-0123456789';
const INSTANCE = instanceIdSchema.parse('B'.repeat(43));
const identity = { token: TOKEN, instanceId: INSTANCE };
const HUGE_BYTES = 300 * (1 << 20);
/** Far more than the socket buffers hold, far less than the body. */
const WROTE_AT_MOST_BYTES = 32 * (1 << 20);
const started: Impostor[] = [];

async function impostor(...args: Parameters<typeof startImpostor>): Promise<Impostor> {
  const server = await startImpostor(...args);

  started.push(server);

  return server;
}

/** A caller's abort far after `timeoutMs`: a client with no timeout fails a test, not hangs it. */
function safetyNet(): AbortSignal {
  return AbortSignal.timeout(1500);
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
});

describe('verifyServer: an answer that is too large to be the server', () => {
  it('is the wrong server, stops reading and cancels a streamed body, so the sender wrote little', async () => {
    let body: ReturnType<typeof streamHugeBody> | undefined;
    const closed = Promise.withResolvers<undefined>();
    const server = await impostor((_request, response) => {
      response.once('close', () => closed.resolve(undefined));
      body = streamHugeBody({ response, totalBytes: HUGE_BYTES });
    });

    expect(await verifyServer({ url: server.url, ...identity })).toEqual({
      status: 'wrong_server',
    });

    await closed.promise;

    expect(body?.ended()).toBe(false);
    expect(body?.written()).toBeLessThan(WROTE_AT_MOST_BYTES);
    expect(body?.written()).toBeLessThan(HUGE_BYTES / 4);
  });

  it('is the wrong server at once when content-length already says the body is too large', async () => {
    const server = await impostor((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '50000000' });
      response.write('{');
    });

    expect(await verifyServer({ url: server.url, ...identity })).toEqual({
      status: 'wrong_server',
    });
  });

  it('rejects a public client call with AnswerTooLargeError', async () => {
    const server = await impostor((_request, response) => {
      streamHugeBody({ response, totalBytes: HUGE_BYTES });
    });

    await expect(createPublicClient({ url: server.url }).call('getHealth', {})).rejects.toThrow(
      AnswerTooLargeError,
    );
  });
});

describe('verifyServer: a redirect', () => {
  it('is the wrong server, and the host it points to receives nothing', async () => {
    const target = await impostor((_request, response) => response.end('{}'));
    const redirecting = await impostor((_request, response) => {
      response.writeHead(307, { location: `${target.url}/handshake` });
      response.end();
    });

    expect(await verifyServer({ url: redirecting.url, ...identity })).toEqual({
      status: 'wrong_server',
    });
    expect(redirecting.requestCount()).toBe(1);
    expect(target.requestCount()).toBe(0);
  });

  it.each([301, 302, 303, 307, 308])(
    'is the wrong server for a %i to an absolute URL, /health or a relative path, and the target is never asked',
    async (status) => {
      const target = await impostor((_request, response) => response.end('{}'));

      for (const location of [`${target.url}/handshake`, '/health', 'elsewhere']) {
        const redirecting = await impostor((_request, response) => {
          response.writeHead(status, { location });
          response.end();
        });

        expect(await verifyServer({ url: redirecting.url, ...identity })).toEqual({
          status: 'wrong_server',
        });
        // A redirect is its own error, not a refusal that happens to be a non-2xx status.
        await expect(
          createPublicClient({ url: redirecting.url }).call('getHealth', {}),
        ).rejects.toThrow(RedirectedError);
        expect(redirecting.requestCount()).toBe(2);
      }

      expect(target.requestCount()).toBe(0);
    },
  );

  it('rejects a public client call with RedirectedError', async () => {
    const redirecting = await impostor((_request, response) => {
      response.writeHead(302, { location: 'http://127.0.0.1:1/health' });
      response.end();
    });

    await expect(
      createPublicClient({ url: redirecting.url }).call('getHealth', {}),
    ).rejects.toThrow(RedirectedError);
  });
});

describe('verifyServer: a server that does not answer', () => {
  it('throws VerifyTimeoutError after timeoutMs instead of staying pending', async () => {
    const server = await impostor(() => undefined);
    const before = performance.now();

    await expect(
      verifyServer({ url: server.url, ...identity, timeoutMs: 100, signal: safetyNet() }),
    ).rejects.toMatchObject({ name: 'VerifyTimeoutError', timeoutMs: 100 });

    expect(performance.now() - before).toBeLessThan(2000);
  });

  it('throws VerifyTimeoutError when the head arrives and the body never finishes', async () => {
    const server = await impostor((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"protocolVersion":');
    });

    await expect(
      verifyServer({ url: server.url, ...identity, timeoutMs: 100, signal: safetyNet() }),
    ).rejects.toBeInstanceOf(VerifyTimeoutError);
  });

  it('keeps the caller’s own abort the caller’s: it is not a timeout', async () => {
    const server = await impostor(() => undefined);
    const caller = new AbortController();

    setTimeout(() => caller.abort(), 50);

    const failure = await verifyServer({
      url: server.url,
      ...identity,
      signal: caller.signal,
    }).catch((caughtError: unknown) => caughtError);

    expect(failure).not.toBeInstanceOf(VerifyTimeoutError);
    expect(failure).toMatchObject({ name: 'AbortError' });
  });
});

describe('verifyServer: an empty token', () => {
  it('throws EmptyTokenError before any request is made', async () => {
    const { fetch, requests } = recordingFetch(() => new Response('{}'));

    await expect(
      verifyServer({ url: 'http://server.test', token: '', instanceId: INSTANCE, fetch }),
    ).rejects.toBeInstanceOf(EmptyTokenError);

    expect(requests).toEqual([]);
  });
});
