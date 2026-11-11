import type { z } from 'zod';
import type { tavilySearchOptionsSchema } from './tavily-search.validator.js';

/** Native fetch-compatible transport. Inject a fake in tests; credentials are supplied by the app. */
export type TavilySearchOptions = z.input<typeof tavilySearchOptionsSchema> & {
  fetch?: typeof globalThis.fetch;
};
