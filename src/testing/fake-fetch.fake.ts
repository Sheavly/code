/** Test-only: a fake `fetch` that records requests and replies with SSE streams. */
import type { RecordedRequest } from './testing.types.js';

/** Events that end a Responses stream; a reply without one gets `response.completed` added. */
const TERMINAL_EVENTS = new Set(['response.completed', 'response.incomplete', 'response.failed']);

/** Every request gets the same SSE events (or an HTTP error if `status` isn't 200). */
export function fakeFetch(events: object[], status = 200) {
  return fakeFetchSequence({ responses: [events], status });
}

/**
 * Request N gets `responses[N]` (the last one repeats). Useful for multi-turn tests. Each reply
 * ends with `response.completed`, as the real API's do, unless `complete: false` (a stream cut
 * off mid-reply) or it already has a terminal event.
 */
export function fakeFetchSequence(params: {
  responses: object[][];
  status?: number;
  complete?: boolean;
}) {
  const { responses, status = 200, complete = true } = params;
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
    const sse = withTerminalEvent({ events, complete })
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('');

    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;

  return { fetch, requests };
}

function withTerminalEvent(params: { events: object[]; complete: boolean }): object[] {
  const { events, complete } = params;
  const ended = events.some((event) => 'type' in event && TERMINAL_EVENTS.has(String(event.type)));

  return complete && !ended ? [...events, { type: 'response.completed', response: {} }] : events;
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) items.push(item);

  return items;
}
