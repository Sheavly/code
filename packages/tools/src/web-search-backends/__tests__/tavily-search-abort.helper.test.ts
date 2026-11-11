import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { fakeFetch } from '../../testing/web-search.fake.js';
import { createWebSearchTool } from '../../web-search/web-search.tool.js';
import { createTavilySearchBackend } from '../tavily-search.helper.js';
import type { TavilySearchOptions } from '../tavily-search.types.js';

function run(params: { options: TavilySearchOptions; signal: AbortSignal; timeoutMs?: number }) {
  return runTool({
    tools: [
      createWebSearchTool({
        backend: createTavilySearchBackend(params.options),
        timeoutMs: params.timeoutMs,
      }),
    ],
    call: {
      id: callIdSchema.parse('search'),
      name: 'web_search',
      input: { description: 'Find docs', query: 'docs' },
    },
    signal: params.signal,
  });
}

describe('Tavily search cancellation', () => {
  it('does not start a request when already aborted', async () => {
    const fake = fakeFetch([]);
    const controller = new AbortController();

    controller.abort('secret');
    const result = await run({ options: fake, signal: controller.signal });

    expect(fake.requests).toHaveLength(0);
    expect(result.content).toContain('Tavily search interrupted');
    expect(result.content).not.toContain('secret');
  });

  it('aborts a pending fetch even when the injected fetch does not cooperate', async () => {
    let receivedSignal: AbortSignal | null | undefined;
    let rejectFetch: ((reason: Error) => void) | undefined;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      receivedSignal = init?.signal;

      return new Promise((_resolve, reject) => {
        rejectFetch = reject;
      });
    };
    const controller = new AbortController();
    const pending = run({ options: { fetch }, signal: controller.signal });

    controller.abort('secret');
    const result = await pending;

    rejectFetch?.(new Error('late secret failure'));

    expect(receivedSignal?.aborted).toBe(true);
    expect(result.content).toContain('Tavily search interrupted');
    expect(result.content).not.toContain('secret');
  });

  it('times out a stalled fetch and propagates cancellation to its signal', async () => {
    let receivedSignal: AbortSignal | null | undefined;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      receivedSignal = init?.signal;

      return new Promise(() => {
        // Deliberately uncooperative transport: only the caller's abort race can settle.
      });
    };
    const result = await run({
      options: { fetch },
      signal: new AbortController().signal,
      timeoutMs: 5,
    });

    expect(receivedSignal?.aborted).toBe(true);
    expect(result.content).toContain('Tavily search timed out after 5ms');
  });

  it('cancels a stalled response body on caller abort and timeout', async () => {
    for (const timeout of [false, true]) {
      let cancelled = false;
      let bodyStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        bodyStarted = resolve;
      });
      const body = new ReadableStream<Uint8Array>({
        pull() {
          bodyStarted?.();
        },
        cancel() {
          cancelled = true;
        },
      });
      const response = new Response(body, { headers: { 'content-type': 'application/json' } });
      const controller = new AbortController();
      const pending = run({
        options: fakeFetch([response]),
        signal: controller.signal,
        timeoutMs: timeout ? 5 : 1_000,
      });

      await started;

      if (!timeout) controller.abort('secret');

      const result = await pending;

      // Stream cancellation occurs in the body reader's finally after the abort races settle.
      await Promise.resolve();

      expect(cancelled).toBe(true);
      expect(result.content).toContain(timeout ? 'timed out' : 'interrupted');
      expect(result.content).not.toContain('secret');
      expect(result.artifacts).toBeUndefined();
    }
  });
});
