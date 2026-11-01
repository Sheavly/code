/** Test-only: a fake `fetch` that records requests and replies with SSE streams. */
import type { RecordedRequest } from './testing.types.js';

/** Every request gets the same SSE events (or an HTTP error if `status` isn't 200). */
export function fakeFetch(events: object[], status = 200) {
  return fakeFetchSequence({ responses: [events], status });
}

/** Request N gets `responses[N]` (the last one repeats). Useful for multi-turn tests. */
export function fakeFetchSequence(params: { responses: object[][]; status?: number }) {
  const { responses, status = 200 } = params;
  const requests: RecordedRequest[] = [];

  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: url instanceof Request ? url.url : url.toString(),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as Record<
        string,
        unknown
      >,
    });
    if (status !== 200) return new Response('nope', { status });
    const events = responses[Math.min(requests.length, responses.length) - 1] ?? [];
    const sse = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;

  return { fetch, requests };
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) items.push(item);

  return items;
}
