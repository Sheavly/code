import type { z } from 'zod';
import type { SearchResult } from '../web-search/web-search.types.js';
import type { keylessSearchOptionsSchema } from './keyless-search.validator.js';

/** Native fetch-compatible transport. Inject a fake in tests; an API key is supplied only by the app. */
export type KeylessSearchOptions = z.input<typeof keylessSearchOptionsSchema> & {
  fetch?: typeof globalThis.fetch;
};

/** How one provider's JSON-RPC `tools/call` search endpoint is called and read. */
export type JsonRpcSearchConfig = {
  name: string;
  url: string;
  tool: string;
  buildArguments: (params: { query: string; maxResults: number }) => Record<string, unknown>;
  /** Headers that select keyless access, or authenticate when the app supplied a key. */
  accessHeaders: (apiKey: string | undefined) => Record<string, string>;
  /** Turns the tool's text content into results; throws WebSearchError when it is malformed. */
  parseResults: (text: string) => SearchResult[];
};
