import { describe, expect, it, vi } from 'vitest';
import { handshakeProof, newNonce } from '@sheavly/protocol/handshake/handshake.utils';
import { instanceIdSchema } from '@sheavly/protocol/handshake/handshake.validator';
import { PROTOCOL_VERSION } from '@sheavly/protocol/version/protocol-version.constants';
import { checkProtocolVersion } from '@sheavly/protocol/version/version.utils';
import { honestAnswer, recordingFetch } from '../../testing/handshake-server.fake.js';
import type { HandshakeAnswer } from '../../testing/testing.types.js';
import { verifyServer } from '../verify.helper.js';

// The client's own version is fixed, so a test can name a server on either side of it.
vi.mock('@sheavly/protocol/version/protocol-version.constants', () => ({
  PROTOCOL_VERSION: '1.4.2',
}));

const TOKEN = 'a-secret-token-that-must-never-leave-0123456789';
const INSTANCE = instanceIdSchema.parse('B'.repeat(43));
const OTHER_INSTANCE = instanceIdSchema.parse('C'.repeat(43));
const URL = 'http://server.test';
const holder = { token: TOKEN, instanceId: INSTANCE, protocolVersion: PROTOCOL_VERSION };

/** Verifies against a fake server that answers as `answer` says; gives the result and what was sent. */
async function verify(answer: HandshakeAnswer) {
  const { fetch, requests } = recordingFetch(answer);
  const result = await verifyServer({ url: URL, token: TOKEN, instanceId: INSTANCE, fetch });

  return { result, requests };
}

const nonceOf = (body: string) => (JSON.parse(body) as { nonce: string }).nonce;
const json = (body: unknown, status = 200) => Response.json(body, { status });

describe('verifyServer: what it sends', () => {
  it('sends the token in no request: not in a header, the URL or the body, nor in the result', async () => {
    const { result, requests } = await verify(honestAnswer(holder));

    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(requests[0]?.headers.map(([name]) => name)).not.toContain('authorization');
  });

  it('asks QUERY /handshake with a nonce', async () => {
    const { requests } = await verify(honestAnswer(holder));

    expect(requests[0]).toMatchObject({ url: `${URL}/handshake`, method: 'QUERY' });
    expect(nonceOf(requests[0]?.body ?? '')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('uses a fresh nonce for every call', async () => {
    const first = await verify(honestAnswer(holder));
    const second = await verify(honestAnswer(holder));

    expect(nonceOf(first.requests[0]?.body ?? '')).not.toBe(
      nonceOf(second.requests[0]?.body ?? ''),
    );
  });
});

describe('verifyServer: a server that holds the token', () => {
  it('is verified, with the version it reported', async () => {
    const { result } = await verify(honestAnswer(holder));

    expect(result).toEqual({ status: 'verified', protocolVersion: PROTOCOL_VERSION });
  });

  it('is verified when the versions differ only in the patch', async () => {
    const { result } = await verify(honestAnswer({ ...holder, protocolVersion: '1.4.9' }));

    expect(result).toEqual({ status: 'verified', protocolVersion: '1.4.9' });
  });

  it.each([
    ['older', '0.9.0', '1.4.2', 'server'],
    ['newer', '2.0.0', '1.4.2', 'client'],
  ] as const)(
    'reports a mismatch when the server is %s, naming the side to update',
    async (_name, server, client, older) => {
      const { result } = await verify(honestAnswer({ ...holder, protocolVersion: server }));
      const expected = checkProtocolVersion({ client, server });

      expect(expected.match).toBe(false);
      expect(result).toEqual({
        status: 'version_mismatch',
        older,
        client,
        server,
        message: expected.match ? '' : expected.message,
      });
    },
  );
});

describe('verifyServer: a server that does not prove it', () => {
  const unverified: [string, () => HandshakeAnswer][] = [
    ['holds another token', () => honestAnswer({ ...holder, token: `${TOKEN}-other` })],
    ['is another instance', () => honestAnswer({ ...holder, instanceId: OTHER_INSTANCE })],
    [
      'echoes the nonce as its proof',
      () =>
        ({ nonce }) =>
          json({ protocolVersion: PROTOCOL_VERSION, proof: nonce }),
    ],
    [
      'replays the answer to an earlier nonce',
      () => {
        const earlier = handshakeProof({ ...holder, nonce: newNonce() });

        return async () => json({ protocolVersion: PROTOCOL_VERSION, proof: await earlier });
      },
    ],
    ['answers a body off the contract', () => () => json({ hello: 'world' })],
    [
      'reports a malformed version',
      () =>
        async ({ nonce }) =>
          json({ protocolVersion: '1.0', proof: await handshakeProof({ ...holder, nonce }) }),
    ],
    ['answers something that is not JSON', () => () => new Response('<html>hi</html>')],
    ['answers a server error', () => () => json({ error: 'boom' }, 500)],
  ];

  it.each(unverified)('is the wrong server when it %s', async (_name, makeAnswer) => {
    const { result } = await verify(makeAnswer());

    expect(result).toEqual({ status: 'wrong_server' });
  });

  it('is the wrong server, and says nothing of versions, when it reports an older version with a bad proof', async () => {
    const { result } = await verify(({ nonce }) =>
      json({ protocolVersion: '0.1.0', proof: nonce }),
    );

    expect(result).toEqual({ status: 'wrong_server' });
  });

  it.each([401, 404])('has no handshake when the route answers %i', async (status) => {
    const { result } = await verify(() =>
      json({ error: { code: 'not_found', message: 'No such route' } }, status),
    );

    expect(result).toEqual({ status: 'no_handshake' });
  });
});

describe('verifyServer: a server that is not there', () => {
  it('throws the transport error, not a verdict, and the token is not in it', async () => {
    const failure = new TypeError('fetch failed');
    const fetch = () => Promise.reject(failure);

    await expect(
      verifyServer({ url: URL, token: TOKEN, instanceId: INSTANCE, fetch }),
    ).rejects.toBe(failure);
    expect(failure.message).not.toContain(TOKEN);
  });
});
