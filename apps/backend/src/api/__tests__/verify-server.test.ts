import { createAdaptorServer } from '@hono/node-server';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, onTestFinished } from 'vitest';
import { verifyServer } from '@sheavly/client/client/verify.helper';
import { instanceIdSchema } from '@sheavly/protocol/handshake/handshake.validator';
import { PROTOCOL_VERSION } from '@sheavly/protocol/version/protocol-version.constants';
import { testApi } from '../../testing/api.fake.js';
import { TEST_INSTANCE_ID } from '../../testing/identity.fake.js';
import { TEST_TOKEN } from '../../testing/testing.constants.js';

// End to end, over real sockets: the client's `verifyServer` against the real app, and against an
// impostor that never held the token.

const MADE_UP_PROOF = 'x'.repeat(43);

describe('verifyServer over real HTTP', () => {
  /** Starts `server` on a free port of 127.0.0.1, stops it after the test, and gives its URL. */
  async function listenOnLoopback(server: http.Server) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    onTestFinished(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }

  /** Serves the real app, as `serve.ts` does, and gives its URL. */
  async function realServer() {
    const api = testApi({});

    onTestFinished(() => api.conversations.closeAll());

    return listenOnLoopback(
      createAdaptorServer({ fetch: api.app.fetch, hostname: '127.0.0.1' }) as http.Server,
    );
  }

  /** A plain HTTP server that records every request and answers the handshake with a made-up proof. */
  async function impostor() {
    const received: { url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];

      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({
          url: request.url ?? '',
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, proof: MADE_UP_PROOF }));
      });
    });

    return { url: await listenOnLoopback(server), received };
  }

  it('verifies the real server with the right token and instance id', async () => {
    const url = await realServer();

    expect(await verifyServer({ url, token: TEST_TOKEN, instanceId: TEST_INSTANCE_ID })).toEqual({
      status: 'verified',
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  it('finds the real server to be the wrong one with another token', async () => {
    const url = await realServer();

    expect(
      await verifyServer({ url, token: `${TEST_TOKEN}-other`, instanceId: TEST_INSTANCE_ID }),
    ).toEqual({ status: 'wrong_server' });
  });

  it('finds the real server to be the wrong one with another instance id', async () => {
    const url = await realServer();
    const instanceId = instanceIdSchema.parse('A'.repeat(43));

    expect(await verifyServer({ url, token: TEST_TOKEN, instanceId })).toEqual({
      status: 'wrong_server',
    });
  });

  it('finds an impostor to be the wrong one, and sends it no token', async () => {
    const { url, received } = await impostor();

    expect(await verifyServer({ url, token: TEST_TOKEN, instanceId: TEST_INSTANCE_ID })).toEqual({
      status: 'wrong_server',
    });
    expect(received).toHaveLength(1);
    expect(JSON.stringify(received)).not.toContain(TEST_TOKEN);
    expect(Object.keys(received[0]?.headers ?? {})).not.toContain('authorization');
  });
});
