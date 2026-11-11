import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WebSearchError } from '../errors/web-search.errors.js';
import {
  WEB_SEARCH_DEFAULTS,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_MAX_QUERY_CHARS,
  WEB_SEARCH_MAX_FIELD_CHARS,
  WEB_SEARCH_MAX_URL_CHARS,
  WEB_SEARCH_MAX_TIMEOUT_MS,
  WEB_SEARCH_ARTIFACT_KIND,
} from './web-search.constants.js';
import type { SearchBackend } from './web-search.types.js';

export const searchQuerySchema = z.string().trim().min(1).max(WEB_SEARCH_MAX_QUERY_CHARS);

export const searchResultSchema = z.object({
  title: z.string().max(WEB_SEARCH_MAX_FIELD_CHARS),
  url: z
    .url()
    .max(WEB_SEARCH_MAX_URL_CHARS)
    .refine((value) => {
      const url = new URL(value);

      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    }),
  snippet: z.string().max(WEB_SEARCH_MAX_FIELD_CHARS),
});

const searchResultsSchema = z.array(searchResultSchema).max(100);

export const webSearchOptionsSchema = z.object({
  maxResults: z
    .number()
    .int()
    .positive()
    .max(WEB_SEARCH_MAX_RESULTS)
    .default(WEB_SEARCH_DEFAULTS.maxResults),
  maxSnippetChars: z
    .number()
    .int()
    .positive()
    .max(WEB_SEARCH_MAX_FIELD_CHARS)
    .default(WEB_SEARCH_DEFAULTS.maxSnippetChars),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(WEB_SEARCH_MAX_TIMEOUT_MS)
    .default(WEB_SEARCH_DEFAULTS.timeoutMs),
});

export const searchBackendSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  search: z.custom<SearchBackend['search']>((value) => typeof value === 'function'),
});

export const webSearchArtifactSchema = z.object({
  kind: z.literal(WEB_SEARCH_ARTIFACT_KIND),
  query: searchQuerySchema,
  results: z.array(searchResultSchema).max(WEB_SEARCH_MAX_RESULTS),
});

/** Do not include validation details: invalid external values can contain credentials. */
export function parseSearchResults(params: { input: unknown; backendName: string }) {
  return parseOrThrow({
    schema: searchResultsSchema,
    input: params.input,
    onInvalid: ({ error }) =>
      new WebSearchError(`${params.backendName} search returned invalid results`, { cause: error }),
  });
}
