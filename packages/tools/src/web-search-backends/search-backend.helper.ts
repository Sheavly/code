import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WebSearchError } from '../errors/web-search.errors.js';
import { withAbort } from '../web-fetch/abort.helper.js';
import { readSearchBody } from './search-response.helper.js';
import {
  searchBackendOptionsSchema,
  searchBackendRequestSchema,
} from './search-backend.validator.js';
import type { SearchBackend } from '../web-search/web-search.types.js';
import type { HttpSearchConfig, SearchBackendOptions } from './search-backend.types.js';

/**
 * The one place a concrete search backend talks to the network, so every backend refuses
 * redirects (an app's key cannot be forwarded elsewhere), honours the abort signal, reads a
 * bounded body and fails with a constructed message only.
 *
 * A transport failure carries no `cause`: fetch errors can contain credentials, and the loop
 * records every cause it finds on an error.
 */
export function createHttpSearchBackend(params: {
  config: HttpSearchConfig;
  options?: SearchBackendOptions | undefined;
}): SearchBackend {
  const { config, options = {} } = params;
  const { fetch = globalThis.fetch, ...rest } = options;
  const { name } = config;
  const policy = parseOrThrow({
    schema: searchBackendOptionsSchema,
    input: rest,
    onInvalid: () => new WebSearchError(`Invalid ${name} search configuration`),
  });

  return {
    name,
    async search({ query, maxResults, signal }) {
      const request = parseOrThrow({
        schema: searchBackendRequestSchema,
        input: { query, maxResults },
        onInvalid: () => new WebSearchError(`Invalid ${name} search request`),
      });
      const { url, init } = config.buildRequest({ ...request, apiKey: policy.apiKey });

      try {
        signal.throwIfAborted();

        const response = await withAbort({
          operation: fetch(url, { ...init, redirect: 'error', signal }),
          signal,
        });
        const body = await readSearchBody({
          name,
          response,
          maxBytes: policy.maxBytes,
          signal,
          contentTypes: config.contentTypes,
        });

        return config.parseBody(body);
      } catch (caughtError) {
        if (caughtError instanceof WebSearchError) throw caughtError;

        throw new WebSearchError(
          signal.aborted ? `${name} search interrupted` : `${name} search request failed`,
        );
      }
    },
  };
}
