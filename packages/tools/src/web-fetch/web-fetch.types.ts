import type { LookupAddress } from 'node:dns';
import type { RequestInit } from 'undici';
import type { z } from 'zod';
import type { webFetchOptionsSchema } from './web-fetch.validator.js';

/** Trusted host dependencies; a custom fetch must honour the supplied pinned dispatcher. */
export type WebFetchOptions = z.input<typeof webFetchOptionsSchema> & {
  fetch?: (url: string, init: RequestInit) => Promise<WebFetchResponse>;
  resolveAddresses?: (hostname: string) => Promise<LookupAddress[]>;
};

export type WebFetchPolicy = z.output<typeof webFetchOptionsSchema>;

/** The response surface needed by the reader, shared by native and injected fetch implementations. */
export type WebFetchResponse = {
  status: number;
  ok: boolean;
  headers: Pick<Headers, 'get'>;
  body: ReadableStream<Uint8Array> | null;
};

export type DownloadedPage = {
  url: URL;
  status: number;
  contentType: string;
  text: string;
  truncated: boolean;
};
