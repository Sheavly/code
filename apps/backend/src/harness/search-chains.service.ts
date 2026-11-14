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
import type { WEB_SEARCH_BACKEND_NAMES } from './harness.constants.js';

type BackendName = (typeof WEB_SEARCH_BACKEND_NAMES)[number];

const factories: Record<BackendName, () => SearchBackend> = {
  tavily: () => createTavilySearchBackend(),
  tinyfish: () => createTinyFishSearchBackend(),
  exa: () => createExaSearchBackend(),
  parallel: () => createParallelSearchBackend(),
  firecrawl: () => createFirecrawlSearchBackend(),
  wikipedia: () => createWikipediaSearchBackend(),
};

/**
 * The fallback chains one backend serves. A chain remembers which backends are rate limited, so
 * every conversation of this backend that asks for the same order shares one chain and its
 * cooldowns; a second `SearchChains` (a test, another backend) shares nothing.
 */
export class SearchChains {
  readonly #chains = new Map<string, SearchBackend>();

  /** The chain trying `names` in order. `names` must be unique and not empty. */
  chainFor(names: readonly BackendName[]): SearchBackend {
    const key = names.join(',');
    const existing = this.#chains.get(key);

    if (existing) return existing;

    const chain = createFallbackSearchBackend({ backends: names.map((name) => factories[name]()) });

    this.#chains.set(key, chain);

    return chain;
  }
}
