import type { ToolArtifact } from '@sheavly/protocol/event/event.types';
import { WEB_SEARCH_MAX_TITLE_CHARS } from './web-search.constants.js';
import { webSearchArtifactSchema } from './web-search.validator.js';
import type { SearchResult, WebSearchArtifact, WebSearchPolicy } from './web-search.types.js';

/** Validates the entire owned payload, not just its tag, before a UI trusts it. */
export function isWebSearchArtifact(artifact: ToolArtifact): artifact is WebSearchArtifact {
  return webSearchArtifactSchema.safeParse(artifact).success;
}

export function boundSearchResults(params: { results: SearchResult[]; policy: WebSearchPolicy }) {
  return params.results.slice(0, params.policy.maxResults).map((result) => ({
    title: result.title.slice(0, WEB_SEARCH_MAX_TITLE_CHARS),
    url: result.url,
    snippet: result.snippet.slice(0, params.policy.maxSnippetChars),
  }));
}
