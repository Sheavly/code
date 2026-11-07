import type { RequestInit } from 'undici';
import type { LookupAddress } from 'node:dns';
import type { WebFetchOptions } from '../web-fetch/web-fetch.types.js';

/** HTTP replies with recorded transport options and public DNS, without any network access. */
export function fakeFetch(responses: Response[]) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch: NonNullable<WebFetchOptions['fetch']> = async (url, init) => {
    requests.push({ url, init });
    const response = responses[requests.length - 1];

    if (!response) throw new Error(`Unexpected request: ${url}`);

    return response;
  };
  const resolveAddresses = async (_hostname: string): Promise<LookupAddress[]> => [
    { address: '93.184.216.34', family: 4 },
  ];

  return { fetch, requests, resolveAddresses };
}
