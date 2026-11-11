import type { z } from 'zod';
import type {
  searchResultSchema,
  webSearchArtifactSchema,
  webSearchOptionsSchema,
} from './web-search.validator.js';

export type SearchResult = z.infer<typeof searchResultSchema>;

/** A host-selected search provider. Honour signal and return only public title/URL/snippet data. */
export type SearchBackend = {
  name: string;
  search: (params: {
    query: string;
    maxResults: number;
    signal: AbortSignal;
  }) => Promise<SearchResult[]>;
};

/** UI data owned by web_search; the same bounded results are also returned to the model. */
export type WebSearchArtifact = z.infer<typeof webSearchArtifactSchema>;

export type WebSearchOptions = z.input<typeof webSearchOptionsSchema> & {
  backend: SearchBackend;
};

export type WebSearchPolicy = z.output<typeof webSearchOptionsSchema>;
