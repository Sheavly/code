import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@sheavly/protocol/version/protocol-version.constants';
import { recordingFetch } from '../../testing/handshake-server.fake.js';
import { instanceIdSchema } from '@sheavly/protocol/handshake/handshake.validator';
import { RedirectedError, RefusedError } from '../../errors/client.errors.js';
import { createClient, createPublicClient } from '../client.helper.js';
import { verifyServer } from '../verify.helper.js';

const TOKEN = 'a-secret-token-that-must-never-leave-0123456789';
const URL = 'http://server.test';
const NONCE = 'n'.repeat(43);
const INSTANCE = instanceIdSchema.parse('B'.repeat(43));
const refusing = () =>
  Response.json({ error: { code: 'forbidden', message: 'no' } }, { status: 403 });
const headerNames = (headers: [string, string][]) => headers.map(([name]) => name);

describe('createClient: the Authorization header', () => {
  it('sends the token on a private route', async () => {
    const { fetch, requests } = recordingFetch(refusing);
    const client = createClient({ url: URL, token: TOKEN, fetch });

    await expect(client.call('listConversations', {})).rejects.toBeInstanceOf(RefusedError);

    expect(new Headers(requests[0]?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('does not send it on the public routes getHealth and queryHandshake', async () => {
    const { fetch, requests } = recordingFetch(refusing);
    const client = createClient({ url: URL, token: TOKEN, fetch });

    await expect(client.call('getHealth', {})).rejects.toBeInstanceOf(RefusedError);
    await expect(client.call('queryHandshake', { body: { nonce: NONCE } })).rejects.toBeInstanceOf(
      RefusedError,
    );

    expect(requests).toHaveLength(2);

    for (const request of requests) {
      expect(headerNames(request.headers)).not.toContain('authorization');
    }

    expect(JSON.stringify(requests)).not.toContain(TOKEN);
  });

  it('calls the public routes like any route, typed and parsed', async () => {
    const { fetch } = recordingFetch(() =>
      Response.json({ status: 'ok', serverVersion: '0.3.1', protocolVersion: PROTOCOL_VERSION }),
    );
    const client = createClient({ url: URL, token: TOKEN, fetch });

    expect(await client.call('getHealth', {})).toEqual({
      status: 'ok',
      serverVersion: '0.3.1',
      protocolVersion: PROTOCOL_VERSION,
    });
  });
});

describe('createClient: the redirect policy', () => {
  /** A `fetch` that keeps the `redirect` option each request was made with. */
  function redirectsSeen() {
    const seen: (string | undefined)[] = [];
    const fetch = (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(init?.redirect);

      return Promise.resolve(refusing());
    };

    return { seen, fetch };
  }

  it('never follows a redirect on a public route, and leaves a private route as it was', async () => {
    const { seen, fetch } = redirectsSeen();
    const client = createClient({ url: URL, token: TOKEN, fetch });

    await expect(client.call('getHealth', {})).rejects.toBeInstanceOf(RefusedError);
    await expect(client.call('listConversations', {})).rejects.toBeInstanceOf(RefusedError);

    expect(seen).toEqual(['manual', undefined]);
  });

  const opaqueRedirect = () => {
    const response = new Response(null, { status: 200 });

    Object.defineProperty(response, 'type', { value: 'opaqueredirect' });

    return response;
  };
  const found = () =>
    new Response(null, { status: 302, headers: { location: 'http://other.test/health' } });

  it.each([
    ['a browser-like opaque redirect', opaqueRedirect],
    ['a 302 with a Location header', found],
  ])('treats %s as RedirectedError and verifies wrong_server', async (_label, answer) => {
    const { fetch } = recordingFetch(answer);

    await expect(createPublicClient({ url: URL, fetch }).call('getHealth', {})).rejects.toThrow(
      RedirectedError,
    );
    expect(await verifyServer({ url: URL, token: TOKEN, instanceId: INSTANCE, fetch })).toEqual({
      status: 'wrong_server',
    });
  });
});

describe('createPublicClient', () => {
  it('calls a public route and never sends an Authorization header', async () => {
    const { fetch, requests } = recordingFetch(() =>
      Response.json({ status: 'ok', serverVersion: '0.3.1', protocolVersion: PROTOCOL_VERSION }),
    );
    const client = createPublicClient({ url: URL, fetch });

    expect((await client.call('getHealth', {})).status).toBe('ok');
    expect(requests).toHaveLength(1);
    expect(headerNames(requests[0]?.headers ?? [])).not.toContain('authorization');
  });

  it('refuses a private route, as a type error and at run time, and sends nothing', async () => {
    const { fetch, requests } = recordingFetch(refusing);
    const client = createPublicClient({ url: URL, fetch });

    // @ts-expect-error a private route name is not a public route.
    await expect(client.call('listConversations', {})).rejects.toThrow(TypeError);
    expect(requests).toEqual([]);
  });

  it('drops a token passed to it anyway: it can never send one', async () => {
    const { fetch, requests } = recordingFetch(refusing);
    const options = { url: URL, fetch, token: TOKEN };
    const client = createPublicClient(options);

    await expect(client.call('queryHandshake', { body: { nonce: NONCE } })).rejects.toBeInstanceOf(
      RefusedError,
    );

    expect(JSON.stringify(requests)).not.toContain(TOKEN);
    expect(headerNames(requests[0]?.headers ?? [])).not.toContain('authorization');
  });
});
