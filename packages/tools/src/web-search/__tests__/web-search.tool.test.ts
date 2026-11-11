import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { toolRunner } from '@sheavly/testing/tool/tool-runner.fake';
import { createWebSearchTool } from '../web-search.tool.js';
import { isWebSearchArtifact } from '../web-search.utils.js';
import type { SearchBackend, SearchResult, WebSearchOptions } from '../web-search.types.js';

const result = {
  title: 'Documentation',
  url: 'https://example.com/docs',
  snippet: 'Useful content',
};

function run(options: WebSearchOptions, input = { query: 'docs' }) {
  return toolRunner([createWebSearchTool(options)])('search', 'web_search', input);
}

function runWithSignal(params: {
  backend: SearchBackend;
  signal: AbortSignal;
  timeoutMs?: number;
}) {
  return runTool({
    tools: [createWebSearchTool({ backend: params.backend, timeoutMs: params.timeoutMs })],
    call: {
      id: callIdSchema.parse('search'),
      name: 'web_search',
      input: { description: 'Find docs', query: 'docs' },
    },
    signal: params.signal,
  });
}

describe('web_search', () => {
  it('requires an explicit backend and validates host configuration', () => {
    for (const options of [
      {},
      { backend: {} },
      { backend: { name: 'bad name', search: async () => [] } },
      { backend: { name: 'test', search: async () => [] }, maxResults: 0 },
      { backend: { name: 'test', search: async () => [] }, maxResults: 21 },
      { backend: { name: 'test', search: async () => [] }, maxSnippetChars: -1 },
      { backend: { name: 'test', search: async () => [] }, timeoutMs: 2_147_483_648 },
    ]) {
      expect(() => createWebSearchTool(options as WebSearchOptions)).toThrow();
    }
  });

  it('passes a trimmed query and host ceiling to the selected provider and returns a narrowed artifact', async () => {
    const requests: Parameters<SearchBackend['search']>[0][] = [];
    const backend: SearchBackend = {
      name: 'custom',
      async search(params) {
        requests.push(params);

        return [{ ...result, title: 't'.repeat(400) }, result, result];
      },
    };
    const answer = await run({ backend, maxResults: 2, maxSnippetChars: 6 }, { query: '  docs  ' });
    const artifact = answer.artifacts?.find(isWebSearchArtifact);

    expect(requests[0]).toMatchObject({ query: 'docs', maxResults: 2 });
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(answer.isError).toBe(false);
    expect(artifact?.kind).toBe('web_search');
    expect(artifact?.results).toHaveLength(2);
    expect(artifact?.results[0]?.title).toHaveLength(300);
    expect(artifact?.results[0]?.snippet).toBe('Useful');
    expect(JSON.parse(answer.content)).toEqual({ query: 'docs', results: artifact?.results });
    expect(
      isWebSearchArtifact({ kind: 'web_search', query: 'docs', results: [{ title: 'bad' }] }),
    ).toBe(false);
    expect(isWebSearchArtifact({ kind: 'other' })).toBe(false);
  });

  it('represents no results as a successful empty structured list', async () => {
    const answer = await run({ backend: { name: 'empty', search: async () => [] } });

    expect(answer.isError).toBe(false);
    expect(JSON.parse(answer.content)).toEqual({ query: 'docs', results: [] });
  });

  it('rejects invalid input without invoking the backend', async () => {
    let called = false;
    const backend: SearchBackend = {
      name: 'test',
      search: async () => {
        called = true;

        return [];
      },
    };

    for (const query of ['', '  ', 'q'.repeat(2_001)]) {
      expect((await run({ backend }, { query })).isError).toBe(true);
    }

    expect(called).toBe(false);
  });

  it('validates custom backend results without exposing invalid values or thrown secrets', async () => {
    for (const returned of [
      [{ ...result, url: 'https://user:secret@example.com' }],
      [{ ...result, url: 'file:///secret' }],
      [{ title: 'secret', url: result.url }],
      { results: 'secret' },
    ]) {
      const backend: SearchBackend = {
        name: 'custom',
        search: async () => returned as SearchResult[],
      };
      const answer = await run({ backend });

      expect(answer.isError).toBe(true);
      expect(answer.content).toContain('custom search returned invalid results');
      expect(answer.content).not.toContain('secret');
      expect(answer.artifacts).toBeUndefined();
    }

    const failure = await run({
      backend: {
        name: 'custom',
        search: async () => {
          throw new Error('Bearer secret');
        },
      },
    });

    expect(failure.content).toContain('custom search failed');
    expect(failure.content).not.toContain('secret');
  });

  it('does not call a backend after pre-abort and does not expose abort reasons', async () => {
    let called = false;
    const controller = new AbortController();

    controller.abort('secret abort reason');
    const answer = await runWithSignal({
      backend: {
        name: 'custom',
        search: async () => {
          called = true;

          return [];
        },
      },
      signal: controller.signal,
    });

    expect(called).toBe(false);
    expect(answer.content).toContain('custom search interrupted');
    expect(answer.content).not.toContain('secret');
  });

  it('stops waiting for uncooperative backends on abort or timeout', async () => {
    const controller = new AbortController();
    const backend: SearchBackend = {
      name: 'slow',
      search: ({ signal }) =>
        new Promise(() => {
          if (signal === controller.signal) {
            throw new Error('Expected combined cancellation signal');
          }
        }),
    };
    const pending = runWithSignal({ backend, signal: controller.signal });

    controller.abort();
    const aborted = await pending;
    const timedOut = await runWithSignal({
      backend,
      signal: new AbortController().signal,
      timeoutMs: 5,
    });

    expect(aborted.content).toContain('slow search interrupted');
    expect(timedOut.content).toContain('slow search timed out after 5ms');
  });
});
