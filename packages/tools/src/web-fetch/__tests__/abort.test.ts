import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { fakeFetch } from '../../testing/web-fetch.fake.js';
import { createWebFetchTool } from '../web-fetch.tool.js';
import type { WebFetchOptions } from '../web-fetch.types.js';

const run = (options: WebFetchOptions, signal = new AbortController().signal) =>
  runTool({
    tools: [createWebFetchTool(options)],
    signal,
    call: {
      id: callIdSchema.parse('abort-1'),
      name: 'web_fetch',
      input: { description: 'Read docs', url: 'https://example.com/' },
    },
  });

describe('web_fetch cancellation and failures', () => {
  it('returns a matching error tool result for a pre-aborted run, without DNS or fetch', async () => {
    const controller = new AbortController();
    const fake = fakeFetch([]);

    controller.abort();

    const result = await run(fake, controller.signal);

    expect(result.role).toBe('tool');
    expect(result.toolCallId).toBe('abort-1');
    expect(result.isError).toBe(true);
    expect(result.content).toContain('interrupted');
    expect(fake.requests).toHaveLength(0);
  });

  it('passes the run signal to fetch and stops waiting when interrupted', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    let started: (() => void) | undefined;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fake = fakeFetch([]);
    const pending = run(
      {
        ...fake,
        fetch: (_url, init) => {
          requestSignal = init.signal ?? undefined;
          started?.();

          return new Promise(() => {
            /* Simulate a dependency that never settles. */
          });
        },
      },
      controller.signal,
    );

    await began;
    controller.abort();

    const result = await pending;

    expect(requestSignal?.aborted).toBe(true);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('interrupted');
  });

  it('times out while waiting for DNS without making a request', async () => {
    const fake = fakeFetch([]);
    const result = await run({
      ...fake,
      timeoutMs: 10,
      resolveAddresses: () =>
        new Promise(() => {
          /* DNS stalls. */
        }),
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('timed out after 10 ms');
    expect(fake.requests).toHaveLength(0);
  });

  it('applies the timeout to a fetch which never receives headers', async () => {
    const fake = fakeFetch([]);
    const result = await run({
      ...fake,
      timeoutMs: 10,
      fetch: () =>
        new Promise(() => {
          /* Headers never arrive. */
        }),
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('timed out after 10 ms');
  });

  it('cancels a stalled response body on timeout', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const fake = fakeFetch([new Response(stream, { headers: { 'content-type': 'text/plain' } })]);
    const result = await run({ ...fake, timeoutMs: 10 });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('timed out');
    expect(cancelled).toBe(true);
  });

  it('returns network and DNS errors as tool results', async () => {
    const fake = fakeFetch([]);
    const network = await run({
      ...fake,
      fetch: async () => {
        throw new TypeError('connection refused');
      },
    });
    const dns = await run({
      ...fake,
      resolveAddresses: async () => {
        throw new Error('DNS unavailable');
      },
    });

    expect(network.isError).toBe(true);
    expect(network.content).toContain('Web fetch failed: connection refused');
    expect(dns.isError).toBe(true);
    expect(dns.content).toContain('DNS unavailable');
  });
});
