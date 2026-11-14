import { describe, expect, it } from 'vitest';
import { WebSearchError, WebSearchRateLimitError } from '../../errors/web-search.errors.js';
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
        fetch: async () => {
          throw new Error('boom test-key');
        },
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

describe('every search backend failure', () => {
  const search = (backend: { search: (p: never) => Promise<unknown> }) =>
    backend.search({ query: 'q', maxResults: 1, signal: new AbortController().signal } as never);

  it('maps a rate limit to WebSearchRateLimitError with the provider Retry-After', async () => {
    for (const create of factories) {
      const backend = create(
        fakeFetch([new Response('x', { status: 429, headers: { 'retry-after': '7' } })]),
      );
      const failure = await search(backend).catch((caughtError: unknown) => caughtError);

      expect(failure, backend.name).toBeInstanceOf(WebSearchRateLimitError);
      expect((failure as WebSearchRateLimitError).retryAfterMs, backend.name).toBe(7_000);
    }
  });

  it("maps Tavily's plan limit 432 to a rate limit and 433 to exhausted quota", async () => {
    const limited = await search(
      createTavilySearchBackend(fakeFetch([new Response('x', { status: 432 })])),
    ).catch((caughtError: unknown) => caughtError);
    const exhausted = await search(
      createTavilySearchBackend(fakeFetch([new Response('x', { status: 433 })])),
    ).catch((caughtError: unknown) => caughtError);

    expect(limited).toBeInstanceOf(WebSearchRateLimitError);
    expect(exhausted).not.toBeInstanceOf(WebSearchRateLimitError);
    expect((exhausted as Error).message).toContain('quota exhausted');
  });

  it('never attaches a cause, whatever failed', async () => {
    const replies = [
      () => new Response('not json', { headers: { 'content-type': 'application/json' } }),
      () => new Response('{"result":{}}', { headers: { 'content-type': 'application/json' } }),
      () => new Response('x', { status: 500 }),
    ];

    for (const create of factories) {
      const attempts = [
        ...replies.map((reply) => create({ fetch: async () => reply(), apiKey: 'test-key' })),
        create({
          fetch: async () => {
            throw new Error('boom test-key');
          },
          apiKey: 'test-key',
        }),
      ];

      for (const backend of attempts) {
        const failure = await search(backend).catch((caughtError: unknown) => caughtError);

        expect(failure, backend.name).toBeInstanceOf(WebSearchError);
        expect((failure as Error).cause, backend.name).toBeUndefined();
      }
    }
  });

  it('attaches no cause when a well-formed reply holds invalid results', async () => {
    const rpc = (text: string) =>
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } });
    const bad = 'javascript:secret';
    // Wikipedia builds its URLs on a fixed host, so it has no invalid-URL reply to send.
    const replies = [
      [createTinyFishSearchBackend, rpc(JSON.stringify({ results: [{ title: 't', url: bad }] }))],
      [createParallelSearchBackend, rpc(JSON.stringify({ results: [{ title: 't', url: bad }] }))],
      [
        createFirecrawlSearchBackend,
        rpc(JSON.stringify({ data: { web: [{ title: 't', url: bad }] } })),
      ],
      [createExaSearchBackend, rpc(`Title: t\nURL: ${bad}\nHighlights:\ns`)],
      [
        createTavilySearchBackend,
        JSON.stringify({ results: [{ title: 't', url: bad, content: 'c' }] }),
      ],
    ] as const;

    for (const [create, body] of replies) {
      const backend = create({
        fetch: async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
      });
      const failure = await search(backend).catch((caughtError: unknown) => caughtError);

      expect(failure, backend.name).toBeInstanceOf(WebSearchError);
      expect((failure as Error).message, backend.name).toContain('invalid results');
      expect((failure as Error).message, backend.name).not.toContain('secret');
      expect((failure as Error).cause, backend.name).toBeUndefined();
    }
  });

  it('attaches no cause when the caller aborts', async () => {
    for (const create of factories) {
      const backend = create(fakeFetch([]));
      const controller = new AbortController();

      controller.abort(new Error('abort-secret'));

      const failure = await backend
        .search({ query: 'q', maxResults: 1, signal: controller.signal })
        .catch((caughtError: unknown) => caughtError);

      expect(failure, backend.name).toBeInstanceOf(WebSearchError);
      expect((failure as Error).message, backend.name).not.toContain('abort-secret');
      expect((failure as Error).cause, backend.name).toBeUndefined();
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
