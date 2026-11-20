import { handshakeProof } from '@sheavly/protocol/handshake/handshake.utils';
import type { HandshakeAnswer, HandshakeIdentity, SentRequest } from './testing.types.js';

/**
 * Test-only: a `fetch` that records every request it gets (URL, method, headers, body) and
 * answers each one the way `answer` says, given the nonce the request carried. A request whose
 * body has no nonce (health, say) is answered with an empty nonce.
 */
export function recordingFetch(answer: HandshakeAnswer) {
  const requests: SentRequest[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' ? init.body : '';

    requests.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? 'GET',
      headers: [...new Headers(init?.headers).entries()],
      body,
    });

    const nonce = body ? (JSON.parse(body) as { nonce?: string }).nonce : undefined;

    return answer({ nonce: nonce ?? '' });
  };

  return { fetch, requests };
}

/** Test-only: the answer of a server that holds `identity`: a real proof over the nonce. */
export function honestAnswer(identity: HandshakeIdentity): HandshakeAnswer {
  return async ({ nonce }) =>
    Response.json({
      protocolVersion: identity.protocolVersion,
      proof: await handshakeProof({ ...identity, nonce }),
    });
}
