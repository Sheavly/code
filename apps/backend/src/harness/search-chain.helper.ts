import { createFallbackSearchBackend } from '@sheavly/tools/web-search-backends/fallback-search.helper';
import {
  createExaSearchBackend,
  createFirecrawlSearchBackend,
  createParallelSearchBackend,
  createTinyFishSearchBackend,
} from '@sheavly/tools/web-search-backends/keyless-search.helper';
import { createTavilySearchBackend } from '@sheavly/tools/web-search-backends/tavily-search.helper';
import { createWikipediaSearchBackend } from '@sheavly/tools/web-search-backends/wikipedia-search.helper';
import type { SearchBackend } from '@sheavly/tools/web-search/web-search.types';
import { DEFAULT_WEB_SEARCH_BACKENDS, type WEB_SEARCH_BACKEND_NAMES } from './harness.constants.js';

const factories: Record<(typeof WEB_SEARCH_BACKEND_NAMES)[number], () => SearchBackend> = {
  tavily: () => createTavilySearchBackend(),
  tinyfish: () => createTinyFishSearchBackend(),
  exa: () => createExaSearchBackend(),
  parallel: () => createParallelSearchBackend(),
  firecrawl: () => createFirecrawlSearchBackend(),
  wikipedia: () => createWikipediaSearchBackend(),
};

// A chain remembers which backends are rate limited, so conversations with the same order share one.
const chains = new Map<string, SearchBackend>();

/**
 * Search that tries the named keyless backends in order, moving on when one is rate limited,
 * slow or failing. The same order returns the same chain, so a cooldown applies to every
 * conversation of this process.
 */
export function createSearchChain(
  names: readonly (typeof WEB_SEARCH_BACKEND_NAMES)[number][] = DEFAULT_WEB_SEARCH_BACKENDS,
) {
  const key = names.join(',');
  const existing = chains.get(key);

  if (existing) return existing;

  const chain = createFallbackSearchBackend({ backends: names.map((name) => factories[name]()) });

  chains.set(key, chain);

  return chain;
}
