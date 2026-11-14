import type { SearchResult } from '../web-search/web-search.types.js';

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
