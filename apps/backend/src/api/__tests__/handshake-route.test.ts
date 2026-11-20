import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@sheavly/protocol/version/protocol-version.constants';
import { newNonce, verifyHandshakeProof } from '@sheavly/protocol/handshake/handshake.utils';
import {
  handshakeResponseSchema,
  instanceIdSchema,
} from '@sheavly/protocol/handshake/handshake.validator';
import { useTempFolders } from '@sheavly/testing/files/temp-folders.fake';
import { TEST_INSTANCE_ID } from '../../testing/identity.fake.js';
import { testBackend } from '../../testing/backend.fake.js';
import { TEST_INSTANCE_ID_TEXT, TEST_LONG_TOKEN } from '../../testing/testing.constants.js';

const folders = useTempFolders({ prefix: 'handshake-route-', names: ['app'] });

/** The real backend, started with the long token, and a way to ask it for a proof with no token. */
function handshakeApp() {
  const backend = testBackend({
    home: `${folders.base}/home`,
    workspace: folders.app,
    token: TEST_LONG_TOKEN,
  });
  const ask = (body: string) =>
    backend.app.request('/handshake', {
      method: 'QUERY',
      headers: { 'content-type': 'application/json' },
      body,
    });
  const prove = async (nonce: string) =>
    handshakeResponseSchema.parse(await (await ask(JSON.stringify({ nonce }))).json());

  return { ...backend, ask, prove };
}

describe('QUERY /handshake', () => {
  it('gives a proof a client holding the token verifies, with the protocol version', async () => {
    const { prove } = handshakeApp();
    const nonce = newNonce();
    const answer = await prove(nonce);

    expect(answer.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(
      await verifyHandshakeProof({
        token: TEST_LONG_TOKEN,
        nonce,
        instanceId: TEST_INSTANCE_ID,
        protocolVersion: answer.protocolVersion,
        proof: answer.proof,
      }),
    ).toBe(true);
  });

  it('gives a proof that fails for another token, instance id, version or nonce', async () => {
    const { prove } = handshakeApp();
    const nonce = newNonce();
    const { proof } = await prove(nonce);
    const right = {
      token: TEST_LONG_TOKEN,
      nonce,
      instanceId: TEST_INSTANCE_ID,
      protocolVersion: PROTOCOL_VERSION,
      proof,
    };

    expect(await verifyHandshakeProof(right)).toBe(true);
    expect(await verifyHandshakeProof({ ...right, token: `${TEST_LONG_TOKEN}x` })).toBe(false);
    expect(
      await verifyHandshakeProof({ ...right, instanceId: instanceIdSchema.parse('A'.repeat(43)) }),
    ).toBe(false);
    expect(await verifyHandshakeProof({ ...right, protocolVersion: '999.0.0' })).toBe(false);
    expect(await verifyHandshakeProof({ ...right, nonce: newNonce() })).toBe(false);
  });

  it('answers one nonce with a proof that does not verify for another (replay)', async () => {
    const { prove } = handshakeApp();
    const recorded = await prove(newNonce());

    expect(
      await verifyHandshakeProof({
        token: TEST_LONG_TOKEN,
        nonce: newNonce(),
        instanceId: TEST_INSTANCE_ID,
        protocolVersion: recorded.protocolVersion,
        proof: recorded.proof,
      }),
    ).toBe(false);
  });

  it('keeps no state: the same nonce gives the same proof, another nonce another', async () => {
    const { prove } = handshakeApp();
    const nonce = newNonce();

    expect((await prove(nonce)).proof).toBe((await prove(nonce)).proof);
    expect((await prove(newNonce())).proof).not.toBe((await prove(nonce)).proof);
  });

  it('shows neither the token nor the instance id in the body or the headers, and logs nothing', async () => {
    const { ask, logged } = handshakeApp();
    const response = await ask(JSON.stringify({ nonce: newNonce() }));
    const everything = JSON.stringify([
      response.status,
      [...response.headers.entries()],
      await response.text(),
    ]);

    expect(response.status).toBe(200);
    expect(everything).not.toContain(TEST_LONG_TOKEN);
    expect(everything).not.toContain(TEST_INSTANCE_ID_TEXT);
    expect(logged).toEqual([]);
  });
});

describe('the nonce of QUERY /handshake', () => {
  const nonces: [string, string][] = [
    ['is empty', ''],
    ['is 21 characters', 'a'.repeat(21)],
    ['is 87 characters', 'a'.repeat(87)],
    ['holds a +', `${'a'.repeat(30)}+`],
    ['holds an =', `${'a'.repeat(30)}=`],
    ['holds a space', `${'a'.repeat(30)} b`],
  ];

  it.each(nonces)('refuses a nonce that %s, without repeating it', async (_name, nonce) => {
    const { ask, logged } = handshakeApp();
    const response = await ask(JSON.stringify({ nonce }));
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'bad_request' } });

    if (nonce !== '') expect(text).not.toContain(nonce);

    expect(logged).toEqual([]);
  });

  it.each([
    ['is missing', '{}'],
    ['is a number', '{"nonce":1}'],
    ['is not JSON', 'nonce'],
    ['is absent with no body', ''],
  ])('refuses a body whose nonce %s', async (_name, body) => {
    const { ask } = handshakeApp();
    const response = await ask(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('accepts the shortest and the longest nonce', async () => {
    const { ask } = handshakeApp();

    for (const nonce of ['a'.repeat(22), 'a'.repeat(86)]) {
      expect((await ask(JSON.stringify({ nonce }))).status).toBe(200);
    }
  });

  it('refuses a 2 KB body before parsing it, even when its nonce is valid', async () => {
    const { ask } = handshakeApp();
    // Valid once parsed (unknown fields are dropped): only the size limit can refuse it.
    const response = await ask(JSON.stringify({ nonce: newNonce(), padding: 'x'.repeat(2048) }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'bad_request' } });
  });
});
