import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WebSearchError } from '../errors/web-search.errors.js';
import {
  WEB_SEARCH_MAX_FIELD_CHARS,
  WEB_SEARCH_MAX_RESULTS,
} from '../web-search/web-search.constants.js';
import { searchQuerySchema, searchResultSchema } from '../web-search/web-search.validator.js';
import { TAVILY_DEFAULT_MAX_BYTES } from './tavily-search.constants.js';

export const tavilySearchOptionsSchema = z.object({
  apiKey: z.string().trim().min(1).max(1_024).optional(),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(WEB_SEARCH_MAX_FIELD_CHARS)
    .default(TAVILY_DEFAULT_MAX_BYTES),
});

export const tavilySearchRequestSchema = z.object({
  query: searchQuerySchema,
  maxResults: z.number().int().positive().max(WEB_SEARCH_MAX_RESULTS),
});

const tavilyResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: searchResultSchema.shape.title,
        url: searchResultSchema.shape.url,
        content: searchResultSchema.shape.snippet,
      }),
    )
    .max(100),
});

/** Reject malformed JSON without echoing parser messages or response fragments. */
export function parseTavilyResponse(text: string) {
  let input: unknown;

  try {
    input = JSON.parse(text) as unknown;
  } catch (caughtError) {
    if (!(caughtError instanceof SyntaxError)) throw caughtError;

    throw new WebSearchError('Tavily search returned invalid JSON', { cause: caughtError });
  }

  return parseOrThrow({
    schema: tavilyResponseSchema,
    input,
    onInvalid: ({ error }) =>
      new WebSearchError('Tavily search returned invalid results', { cause: error }),
  });
}
