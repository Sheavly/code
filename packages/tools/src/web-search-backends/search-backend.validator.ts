import { z } from 'zod';
import {
  WEB_SEARCH_MAX_FIELD_CHARS,
  WEB_SEARCH_MAX_RESULTS,
} from '../web-search/web-search.constants.js';
import { searchQuerySchema } from '../web-search/web-search.validator.js';
import { SEARCH_BACKEND_DEFAULT_MAX_BYTES } from './search-backend.constants.js';

/** What an app may configure on any search backend. */
export const searchBackendOptionsSchema = z.object({
  apiKey: z.string().trim().min(1, 'API key is empty').max(1_024).optional(),
  maxBytes: z
    .int()
    .min(1)
    .max(WEB_SEARCH_MAX_FIELD_CHARS)
    .default(SEARCH_BACKEND_DEFAULT_MAX_BYTES),
});

export const searchBackendRequestSchema = z.object({
  query: searchQuerySchema,
  maxResults: z.number().int().positive().max(WEB_SEARCH_MAX_RESULTS),
});
