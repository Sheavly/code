import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WebSearchError } from '../errors/web-search.errors.js';
import { withAbort } from '../web-fetch/abort.helper.js';
import { readSearchBody } from './search-response.helper.js';
import {
  keylessSearchOptionsSchema,
  keylessSearchRequestSchema,
  parseToolReplyText,
} from './keyless-search.validator.js';
import type { SearchBackend } from '../web-search/web-search.types.js';
import type { JsonRpcSearchConfig, KeylessSearchOptions } from './keyless-search.types.js';

/**
 * Calls a provider's search tool with one plain JSON-RPC `tools/call` POST: no MCP session or
 * handshake, because the keyless endpoints answer without one. Redirects are refused so an app's
 * key cannot be forwarded elsewhere.
 */
export function createJsonRpcSearchBackend(params: {
  config: JsonRpcSearchConfig;
  options?: KeylessSearchOptions | undefined;
}): SearchBackend {
  const { config, options = {} } = params;
  const { fetch = globalThis.fetch, ...rest } = options;
  const { name } = config;
  const policy = parseOrThrow({
    schema: keylessSearchOptionsSchema,
    input: rest,
    onInvalid: ({ error }) =>
      new WebSearchError(`Invalid ${name} search configuration`, { cause: error }),
  });

  return {
    name,
    async search({ query, maxResults, signal }) {
      const request = parseOrThrow({
        schema: keylessSearchRequestSchema,
        input: { query, maxResults },
        onInvalid: ({ error }) =>
          new WebSearchError(`Invalid ${name} search request`, { cause: error }),
      });

      try {
        signal.throwIfAborted();

        const response = await withAbort({
          operation: fetch(config.url, {
            method: 'POST',
            redirect: 'error',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
              ...config.accessHeaders(policy.apiKey),
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: config.tool, arguments: config.buildArguments(request) },
            }),
            signal,
          }),
          signal,
        });
        const body = await readSearchBody({
          name,
          response,
          maxBytes: policy.maxBytes,
          signal,
          contentTypes: ['application/json', 'text/event-stream'],
        });

        return config.parseResults(parseToolReplyText({ body, name }));
      } catch (caughtError) {
        if (caughtError instanceof WebSearchError) throw caughtError;

        // Fetch errors can contain credentials; only deliberately constructed messages cross the boundary.
        throw new WebSearchError(
          signal.aborted ? `${name} search interrupted` : `${name} search request failed`,
          { cause: caughtError },
        );
      }
    },
  };
}
