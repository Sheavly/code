export const WEB_SEARCH_DEFAULTS = {
  maxResults: 5,
  maxSnippetChars: 1_000,
  timeoutMs: 15_000,
} as const;

export const WEB_SEARCH_MAX_RESULTS = 20;
export const WEB_SEARCH_MAX_QUERY_CHARS = 2_000;
export const WEB_SEARCH_MAX_TITLE_CHARS = 300;
export const WEB_SEARCH_MAX_FIELD_CHARS = 1_048_576;
export const WEB_SEARCH_MAX_URL_CHARS = 4_096;
export const WEB_SEARCH_MAX_TIMEOUT_MS = 2_147_483_647;
export const WEB_SEARCH_ARTIFACT_KIND = 'web_search';
