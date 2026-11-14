import { describe, expect, it } from 'vitest';
import { WebSearchRateLimitError } from '../../errors/web-search.errors.js';
import { createTavilySearchBackend } from '../tavily-search.helper.js';
import {
  createExaSearchBackend,
  createFirecrawlSearchBackend,
  createParallelSearchBackend,
  createTinyFishSearchBackend,
} from '../keyless-search.helper.js';
import { createWikipediaSearchBackend } from '../wikipedia-search.helper.js';

// Calls each real keyless endpoint once. Off by default so CI never needs the network:
// run with `LIVE_SEARCH=true npx vitest run live-search` from packages/tools.
const live = process.env.LIVE_SEARCH === 'true';

const backends = [
  createTavilySearchBackend(),
  createTinyFishSearchBackend(),
  createExaSearchBackend(),
  createParallelSearchBackend(),
  createFirecrawlSearchBackend(),
  createWikipediaSearchBackend(),
];

describe.skipIf(!live)('live keyless search endpoints', () => {
  it.each(backends.map((backend) => [backend.name, backend] as const))(
    '%s returns valid results for a real query',
    async (_name, backend) => {
      const results = await backend
        .search({
          query: 'typescript programming language',
          maxResults: 3,
          signal: AbortSignal.timeout(20_000),
        })
        .catch((caughtError: unknown) => {
          // A 429 proves the endpoint answers; the fallback chain exists for exactly this.
          if (caughtError instanceof WebSearchRateLimitError) return undefined;

          throw caughtError;
        });

      if (!results) return;

      expect(results.length).toBeGreaterThan(0);

      for (const result of results) {
        expect(result.url).toMatch(/^https?:\/\//);
        expect(result.title.length + result.snippet.length).toBeGreaterThan(0);
      }
    },
    25_000,
  );
});
