import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WebSearchError } from '../errors/web-search.errors.js';
import { searchResultSchema } from '../web-search/web-search.validator.js';

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

    // No `cause`: a SyntaxError message can quote the body.
    throw new WebSearchError('Tavily search returned invalid JSON');
  }

  return parseOrThrow({
    schema: tavilyResponseSchema,
    input,
    onInvalid: () => new WebSearchError('Tavily search returned invalid results'),
  });
}
