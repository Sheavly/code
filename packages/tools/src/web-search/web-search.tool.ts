import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WebSearchError } from '../errors/web-search.errors.js';
import { WEB_SEARCH_ARTIFACT_KIND } from './web-search.constants.js';
import { executeSearch } from './search.helper.js';
import {
  searchBackendSchema,
  searchQuerySchema,
  webSearchOptionsSchema,
} from './web-search.validator.js';
import type { WebSearchArtifact, WebSearchOptions } from './web-search.types.js';
import { webSearchDescription, webSearchPrompts } from './web-search.prompt.js';

/** Opt-in search: the app must supply a backend. Never discovers credentials or chooses a provider. */
export function createWebSearchTool(options: WebSearchOptions) {
  const { backend, ...limits } = options;
  const policy = parseOrThrow({
    schema: webSearchOptionsSchema,
    input: limits,
    onInvalid: ({ error }) => new WebSearchError('Invalid web search limits', { cause: error }),
  });

  parseOrThrow({
    schema: searchBackendSchema,
    input: backend,
    onInvalid: ({ error }) =>
      new WebSearchError('Web search requires a valid backend', { cause: error }),
  });

  return defineTool({
    name: 'web_search',
    description: webSearchDescription({
      backendName: backend.name,
      maxResults: policy.maxResults,
      maxSnippetChars: policy.maxSnippetChars,
    }),
    inputSchema: z.object({
      query: searchQuerySchema.describe(webSearchPrompts.query),
    }),
    async execute({ input, signal }) {
      const results = await executeSearch({ backend, query: input.query, policy, signal });
      const artifact: WebSearchArtifact = {
        kind: WEB_SEARCH_ARTIFACT_KIND,
        query: input.query,
        results,
      };

      return {
        content: JSON.stringify({ query: input.query, results }),
        artifacts: [artifact],
      };
    },
  });
}
