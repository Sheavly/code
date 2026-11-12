import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../testing/web-search.fake.js';
import {
  createExaSearchBackend,
  createFirecrawlSearchBackend,
  createParallelSearchBackend,
  createTinyFishSearchBackend,
} from '../keyless-search.helper.js';
import { cleanWikipediaSnippet } from '../keyless-search.utils.js';
import { parseRetryAfterMs } from '../retry-after.utils.js';
import { createWikipediaSearchBackend } from '../wikipedia-search.helper.js';
import { createTavilySearchBackend } from '../tavily-search.helper.js';

const factories = [
  createTinyFishSearchBackend,
  createExaSearchBackend,
  createParallelSearchBackend,
  createFirecrawlSearchBackend,
  createWikipediaSearchBackend,
  createTavilySearchBackend,
];

describe('every search backend', () => {
  it('refuses redirects and keeps a failing transport message free of the key', async () => {
    for (const create of factories) {
      const fake = fakeFetch([
        new Response('{}', { headers: { 'content-type': 'application/json' } }),
      ]);
      const backend = create({ ...fake, apiKey: 'test-key' });

      // The empty reply is invalid for every backend; only the request it caused is checked.
      await expect(
        backend.search({ query: 'q', maxResults: 1, signal: new AbortController().signal }),
      ).rejects.toThrow(backend.name);

      expect(fake.requests[0]?.init.redirect, backend.name).toBe('error');

      const failing = create({
        fetch: (async () => {
          throw new Error('boom test-key');
        }),
        apiKey: 'test-key',
      });
      const attempt = failing.search({
        query: 'q',
        maxResults: 1,
        signal: new AbortController().signal,
      });

      await expect(attempt).rejects.toThrow(`${backend.name} search request failed`);
      await expect(attempt).rejects.not.toThrow('test-key');
    }
  });
});

describe('parseRetryAfterMs', () => {
  it('reads seconds, caps them and ignores dates, huge or malformed values', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
    expect(parseRetryAfterMs(' 5 ')).toBe(5_000);
    expect(parseRetryAfterMs('999999')).toBe(300_000);
    expect(parseRetryAfterMs('99999999999999999999')).toBeUndefined();
    expect(parseRetryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
    expect(parseRetryAfterMs('-1')).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });
});

describe('cleanWikipediaSnippet', () => {
  it('strips tags and decodes entities', () => {
    expect(cleanWikipediaSnippet('a <span class="x">b</span> &amp; &quot;c&quot;')).toBe(
      'a b & "c"',
    );
  });

  it('handles a long run of "<" without a closing ">" in linear time', () => {
    const started = performance.now();
    const cleaned = cleanWikipediaSnippet('<'.repeat(200_000));

    expect(cleaned).toHaveLength(200_000);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
