import { RequestSigningError } from '../errors/providers.errors.js';
import type { RequestSigner } from './http.types.js';

/**
 * `init` with the headers `sign` adds for this attempt. Throws when `init` is not what a signature
 * can cover (plain headers and a string body): a signed protocol builds its request that way, so
 * this is a bug in it and not a failure to retry.
 */
export function withSignature(params: {
  init: RequestInit;
  url: URL;
  sign: RequestSigner;
}): RequestInit {
  const { init, url, sign } = params;
  const { headers, body } = init;

  if (
    typeof body !== 'string' ||
    !headers ||
    Array.isArray(headers) ||
    headers instanceof Headers
  ) {
    throw new RequestSigningError({
      message: 'A signed request needs plain headers and a string body',
    });
  }

  const plain = headers as Record<string, string>;
  const added = sign({ method: init.method ?? 'POST', url, headers: plain, body });
  const own = new Set(Object.keys(plain).map((name) => name.toLowerCase()));

  // fetch merges header names without regard to case, so a repeat would send a value the signature
  // did not cover.
  if (Object.keys(added).some((name) => own.has(name.toLowerCase()))) {
    throw new RequestSigningError({ message: 'A signature repeats a header the request has' });
  }

  return { ...init, headers: { ...plain, ...added } };
}
