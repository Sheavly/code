export const KEYLESS_SEARCH_DEFAULT_MAX_BYTES = 1_048_576;
export const SEARCH_MAX_RETRY_AFTER_MS = 300_000;
export const WIKIPEDIA_USER_AGENT = 'sheavly-harness (web_search fallback)';

export const TINYFISH_SEARCH_URL = 'https://agent.tinyfish.ai/mcp';
export const TINYFISH_KEYLESS_HEADERS = { 'X-TinyFish-Access-Mode': 'keyless' } as const;
export const EXA_SEARCH_URL = 'https://mcp.exa.ai/mcp';
export const PARALLEL_SEARCH_URL = 'https://search.parallel.ai/mcp';
export const FIRECRAWL_SEARCH_URL = 'https://mcp.firecrawl.dev/v2/mcp';
export const WIKIPEDIA_SEARCH_URL = 'https://en.wikipedia.org/w/api.php';
export const WIKIPEDIA_ARTICLE_URL = 'https://en.wikipedia.org/wiki/';
