import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WebSearchError } from '../errors/web-search.errors.js';
import {
  WEB_SEARCH_MAX_FIELD_CHARS,
  WEB_SEARCH_MAX_RESULTS,
} from '../web-search/web-search.constants.js';
import { parseSearchResults, searchQuerySchema } from '../web-search/web-search.validator.js';
import {
  KEYLESS_SEARCH_DEFAULT_MAX_BYTES,
  WIKIPEDIA_ARTICLE_URL,
} from './keyless-search.constants.js';
import { cleanWikipediaSnippet } from './keyless-search.utils.js';

const maxBytesSchema = z.int().min(1).max(WEB_SEARCH_MAX_FIELD_CHARS);

export const keylessSearchOptionsSchema = z.object({
  apiKey: z.string().trim().min(1, 'API key is empty').max(1_024).optional(),
  maxBytes: maxBytesSchema.default(KEYLESS_SEARCH_DEFAULT_MAX_BYTES),
});

export const keylessSearchRequestSchema = z.object({
  query: searchQuerySchema,
  maxResults: z.number().int().positive().max(WEB_SEARCH_MAX_RESULTS),
});

const toolReplySchema = z.object({
  result: z.object({
    content: z.array(z.object({ text: z.string().optional() })),
    isError: z.boolean().optional(),
  }),
});

const tinyFishSchema = z.object({
  results: z.array(
    z.object({ title: z.string(), url: z.string(), snippet: z.string().default('') }),
  ),
});

const parallelSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().nullish(),
      url: z.string(),
      excerpts: z.array(z.string()).nullish(),
    }),
  ),
});

const firecrawlSchema = z.object({
  data: z.object({
    web: z.array(
      z.object({
        title: z.string().nullish(),
        url: z.string(),
        description: z.string().nullish(),
      }),
    ),
  }),
});

const wikipediaSchema = z.object({
  query: z.object({
    search: z.array(z.object({ title: z.string(), snippet: z.string().default('') })),
  }),
});

/**
 * Reads the text of a tool reply that arrived as plain JSON or as server-sent events.
 * Messages never include body fragments: invalid external values can contain credentials.
 */
export function parseToolReplyText(params: { body: string; name: string }) {
  const { body, name } = params;

  for (const payload of replyPayloads(body)) {
    const reply = toolReplySchema.safeParse(parseJsonOrUndefined(payload));

    if (!reply.success) continue;

    if (reply.data.result.isError) {
      throw new WebSearchError(`${name} search tool reported an error`);
    }

    const text = reply.data.result.content.find((item) => item.text)?.text;

    if (text) return text;
  }

  throw new WebSearchError(`${name} search returned an invalid response`);
}

function replyPayloads(body: string) {
  const trimmed = body.trim();

  if (trimmed.startsWith('{')) return [trimmed];

  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length).trim());
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (caughtError) {
    if (caughtError instanceof SyntaxError) return undefined;

    throw caughtError;
  }
}

function parseProviderJson<T extends z.ZodType>(params: {
  text: string;
  name: string;
  schema: T;
}): z.output<T> {
  const { text, name, schema } = params;
  const input = parseJsonOrUndefined(text);

  if (input === undefined) throw new WebSearchError(`${name} search returned invalid JSON`);

  return parseOrThrow({
    schema,
    input,
    onInvalid: ({ error }) =>
      new WebSearchError(`${name} search returned invalid results`, { cause: error }),
  });
}

export function parseTinyFishResults(text: string) {
  const { results } = parseProviderJson({ text, name: 'TinyFish', schema: tinyFishSchema });

  return parseSearchResults({ input: results, backendName: 'TinyFish' });
}

export function parseParallelResults(text: string) {
  const { results } = parseProviderJson({ text, name: 'Parallel', schema: parallelSchema });
  const input = results.map((item) => ({
    title: item.title ?? '',
    url: item.url,
    snippet: (item.excerpts ?? []).join('\n'),
  }));

  return parseSearchResults({ input, backendName: 'Parallel' });
}

export function parseFirecrawlResults(text: string) {
  const { data } = parseProviderJson({ text, name: 'Firecrawl', schema: firecrawlSchema });
  const input = data.web.map((item) => ({
    title: item.title ?? '',
    url: item.url,
    snippet: item.description ?? '',
  }));

  return parseSearchResults({ input, backendName: 'Firecrawl' });
}

/** Exa answers with blocks of `Title:`, `URL:`, `Highlights:` lines, separated by a blank line. */
export function parseExaResults(text: string) {
  const input = text
    .split(/(?:^|\n\n)Title: /)
    .slice(1)
    .map((block) => {
      const [title = '', ...rest] = block.split('\n');
      const body = rest.join('\n');

      return {
        title: title.trim(),
        url: /^URL: (\S+)/m.exec(body)?.[1] ?? '',
        snippet: body.split(/^Highlights:\s*\n/m)[1]?.trim() ?? '',
      };
    });

  return parseSearchResults({ input, backendName: 'Exa' });
}

export function parseWikipediaResults(text: string) {
  const { query } = parseProviderJson({ text, name: 'Wikipedia', schema: wikipediaSchema });
  const input = query.search.map((item) => ({
    title: item.title,
    url: `${WIKIPEDIA_ARTICLE_URL}${encodeURIComponent(item.title.replaceAll(' ', '_'))}`,
    snippet: cleanWikipediaSnippet(item.snippet),
  }));

  return parseSearchResults({ input, backendName: 'Wikipedia' });
}
