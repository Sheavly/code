import { describe, expect, it } from 'vitest';
import { toolRunner } from '@sheavly/testing/tool/tool-runner.fake';
import { fakeFetch } from '../../testing/web-search.fake.js';
import { createTavilySearchBackend } from '../tavily-search.helper.js';
import { createWebSearchTool } from '../../web-search/web-search.tool.js';
import type { TavilySearchOptions } from '../tavily-search.types.js';

const item = { title: 'Docs', url: 'https://example.com/docs', content: 'A useful snippet' };

function run(options: TavilySearchOptions) {
  return toolRunner([createWebSearchTool({ backend: createTavilySearchBackend(options) })])(
    'search',
    'web_search',
    { query: 'docs' },
  );
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Tavily search backend', () => {
  it('uses general documented keyless access and extracts only structured results', async () => {
    const fake = fakeFetch([
      jsonResponse({
        results: [{ ...item, score: 0.8, raw_content: 'raw-secret' }],
        answer: 'answer-secret',
        response_time: 0.4,
      }),
    ]);
    const result = await run(fake);
    const sent = fake.requests[0];
    const headers = new Headers(sent?.init.headers);

    expect(sent?.url).toBe('https://api.tavily.com/search');
    expect(sent?.init.method).toBe('POST');
    expect(sent?.init.redirect).toBe('error');
    expect(sent?.init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(headers.entries())).toEqual({
      'content-type': 'application/json',
      'x-tavily-access-mode': 'keyless',
    });
    expect(JSON.parse(sent?.init.body as string)).toEqual({
      query: 'docs',
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toEqual({
      query: 'docs',
      results: [{ title: item.title, url: item.url, snippet: item.content }],
    });
    expect(result.content).not.toContain('secret');
    expect(JSON.stringify(result.artifacts)).not.toContain('secret');
  });

  it('uses only injected Bearer auth when a key is supplied, never identity headers', async () => {
    const fake = fakeFetch([jsonResponse({ results: [] })]);
    const result = await run({ ...fake, apiKey: 'test-private-key' });
    const headers = new Headers(fake.requests[0]?.init.headers);

    expect(Object.fromEntries(headers.entries())).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer test-private-key',
    });
    expect(result.isError).toBe(false);
    expect(result.content).not.toContain('test-private-key');
    expect(JSON.stringify(result.artifacts)).not.toContain('test-private-key');
  });

  it('validates factory configuration without exposing keys or requesting data', () => {
    const fake = fakeFetch([]);

    for (const invalid of [
      { apiKey: '' },
      { apiKey: '  ' },
      { maxBytes: 0 },
      { maxBytes: 1_048_577 },
    ]) {
      expect(() => createTavilySearchBackend({ ...fake, ...invalid })).toThrow(
        'Invalid Tavily search configuration',
      );
    }

    expect(fake.requests).toHaveLength(0);
  });

  it('gives backend-specific HTTP failures without reading or exposing their bodies', async () => {
    for (const [status, reason] of [
      [401, 'access denied'],
      [403, 'access denied'],
      [429, 'rate limit'],
      [432, 'rate limit'],
      [402, 'quota exhausted'],
      [433, 'quota exhausted'],
      [500, 'failed'],
    ] as const) {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('response-secret'));
        },
        cancel() {
          cancelled = true;
        },
      });
      const result = await run({
        ...fakeFetch([new Response(stream, { status })]),
        apiKey: 'test-private-key',
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain(`Tavily search ${reason}`);
      expect(result.content).toContain(`HTTP ${status}`);
      expect(result.content).not.toContain('secret');
      expect(result.content).not.toContain('test-private-key');
      expect(cancelled).toBe(true);
    }
  });

  it('rejects non-JSON, malformed JSON and invalid response fields with safe failures', async () => {
    const responses = [
      new Response('secret', { headers: { 'content-type': 'text/html' } }),
      new Response('secret', { headers: { 'content-type': 'application/json' } }),
      jsonResponse({ results: [{ title: 'secret', url: item.url }] }),
      jsonResponse({ results: [{ ...item, url: 'https://user:secret@example.com' }] }),
      jsonResponse({ results: [{ ...item, url: 'javascript:secret' }] }),
      jsonResponse({ error: 'secret' }),
    ];

    for (const response of responses) {
      const result = await run(fakeFetch([response]));

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tavily search');
      expect(result.content).not.toContain('secret');
      expect(result.artifacts).toBeUndefined();
    }
  });

  it('bounds decoded streamed response bytes, not Content-Length, and cancels oversized streams', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"results":['));
        controller.enqueue(new TextEncoder().encode('secret'.repeat(100)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, {
      headers: { 'content-type': 'application/json', 'content-length': '1' },
    });
    const result = await run({ ...fakeFetch([response]), maxBytes: 20 });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Tavily search response exceeded 20 bytes');
    expect(result.content).not.toContain('secret');
    expect(cancelled).toBe(true);
  });

  it('accepts a complete response exactly at its byte limit and counts multibyte UTF-8', async () => {
    const value = { results: [{ ...item, content: '中文' }] };
    const text = JSON.stringify(value);
    const size = new TextEncoder().encode(text).byteLength;
    const exact = await run({ ...fakeFetch([jsonResponse(value)]), maxBytes: size });
    const tooSmall = await run({ ...fakeFetch([jsonResponse(value)]), maxBytes: text.length });

    expect(exact.isError).toBe(false);
    expect(tooSmall.content).toContain(`exceeded ${text.length} bytes`);
  });

  it('redacts thrown transport messages and does not use a real network fallback', async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new Error('Authorization Bearer test-private-key raw-secret');
    };
    const result = await run({ fetch, apiKey: 'test-private-key' });
    const exhausted = await run(fakeFetch([]));

    expect(result.content).toContain('Tavily search request failed');
    expect(result.content).not.toContain('test-private-key');
    expect(result.content).not.toContain('raw-secret');
    expect(exhausted.isError).toBe(true);
  });
});
