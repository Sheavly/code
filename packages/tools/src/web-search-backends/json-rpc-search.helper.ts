import { parseToolReplyText } from './keyless-search.validator.js';
import { createHttpSearchBackend } from './search-backend.helper.js';
import type { SearchBackend } from '../web-search/web-search.types.js';
import type { JsonRpcSearchConfig } from './keyless-search.types.js';
import type { SearchBackendOptions } from './search-backend.types.js';

/**
 * Calls a provider's search tool with one plain JSON-RPC `tools/call` POST: no MCP session or
 * handshake, because the keyless endpoints answer without one.
 */
export function createJsonRpcSearchBackend(params: {
  config: JsonRpcSearchConfig;
  options?: SearchBackendOptions | undefined;
}): SearchBackend {
  const { config, options } = params;

  return createHttpSearchBackend({
    config: {
      name: config.name,
      contentTypes: ['application/json', 'text/event-stream'],
      buildRequest: ({ query, maxResults, apiKey }) => ({
        url: config.url,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...config.accessHeaders(apiKey),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: config.tool, arguments: config.buildArguments({ query, maxResults }) },
          }),
        },
      }),
      parseBody: (body) => config.parseResults(parseToolReplyText({ body, name: config.name })),
    },
    options,
  });
}
