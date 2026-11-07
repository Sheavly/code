import ipaddr from 'ipaddr.js';
import { WebFetchError } from '../errors/web-fetch.errors.js';
import type { WebFetchPolicy } from './web-fetch.types.js';

/** Refuses special-use ranges and IPv6 outside global unicast, including mapped private IPv4. */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;

  const parsed = ipaddr.process(address);

  if (parsed.range() !== 'unicast') return false;
  if (parsed.kind() === 'ipv4') return true;

  return parsed.match(ipaddr.parse('2000::'), 3);
}

function hostnameOf(url: URL): string {
  return url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

/** No allow list can override the public-address or credential guards. */
export function assertAllowedUrl(params: { url: URL; policy: WebFetchPolicy }): string {
  const { url, policy } = params;

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new WebFetchError('Only HTTP(S) URLs without credentials are allowed');
  }

  const hostname = hostnameOf(url);
  const matches = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new WebFetchError(`Refused non-public host: ${hostname}`);
  }

  if (policy.deniedDomains.some(matches)) {
    throw new WebFetchError(`Domain denied: ${hostname}`);
  }

  if (policy.allowedDomains && !policy.allowedDomains.some(matches)) {
    throw new WebFetchError(`Domain is not in the allow list: ${hostname}`);
  }

  return hostname;
}
