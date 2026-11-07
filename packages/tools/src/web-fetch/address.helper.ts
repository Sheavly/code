import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { Agent } from 'undici';
import { WebFetchError } from '../errors/web-fetch.errors.js';
import { assertAllowedUrl, isPublicAddress } from './address.utils.js';
import { withAbort } from './abort.helper.js';
import type { WebFetchOptions, WebFetchPolicy } from './web-fetch.types.js';

export async function publicDispatcher(params: {
  url: URL;
  policy: WebFetchPolicy;
  resolveAddresses: NonNullable<WebFetchOptions['resolveAddresses']>;
  signal: AbortSignal;
}): Promise<Agent> {
  const { url, policy, resolveAddresses, signal } = params;
  const hostname = assertAllowedUrl({ url, policy });
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await withAbort({ operation: resolveAddresses(hostname), signal });

  signal.throwIfAborted();

  const first = addresses[0];

  if (!first || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new WebFetchError(`Refused non-public address for ${hostname}`);
  }

  // Pin the checked address while retaining the original Host header and TLS server name.
  // Never use a proxy or let a second DNS lookup undo the address check.
  return new Agent({
    connect: {
      autoSelectFamily: false,
      lookup: (_hostname, _options, callback) => callback(null, first.address, first.family),
    },
  });
}

export async function resolvePublicHost(hostname: string): Promise<LookupAddress[]> {
  try {
    return await lookup(hostname, { all: true, order: 'verbatim' });
  } catch (caughtError) {
    throw new WebFetchError(`Could not resolve host: ${hostname}`, { cause: caughtError });
  }
}
