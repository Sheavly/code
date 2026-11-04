import type { z } from 'zod';
import { API_ROUTES, ENTRY_EVENT } from '@sheavly/protocol/api/api.constants';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { RouteName } from '@sheavly/protocol/api/api.types';
import type { FakeCall, FakeHandlers, FakeRefusal } from './testing.types.js';

/** A route of the API, as a fake matches a request against it. */
type Matcher = { name: RouteName; method: string; pattern: RegExp; params: string[] };

const MATCHERS: Matcher[] = Object.entries(API_ROUTES).map(([name, route]) => ({
  name: name as RouteName,
  method: route.method.toUpperCase(),
  pattern: new RegExp(`^${route.path.replace(/\{\w+\}/g, '([^/]+)')}$`),
  params: [...route.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? ''),
}));

const refusal = (refuse: FakeRefusal['refuse']) =>
  Response.json(
    { error: { code: refuse.code, message: refuse.message ?? refuse.code } },
    { status: refuse.status },
  );

/** Test-only: a stream's entries as the backend's SSE frames. */
function sse(entries: AsyncIterable<StreamEntry>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const entry of entries) {
        controller.enqueue(
          encoder.encode(
            `event: ${ENTRY_EVENT}\nid: ${String(entry.seq)}\ndata: ${JSON.stringify(entry)}\n\n`,
          ),
        );
      }

      controller.close();
    },
  });

  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

/**
 * Test-only: a `fetch` that answers the API's routes the way `handlers` say, for a UI's tests of
 * its own logic (the real routes are tested end to end where they live, in the backend). Each
 * request is matched to its route from `API_ROUTES`; a JSON answer is checked against the route's
 * schema, so a fake can't answer what the real backend couldn't. `calls` records every call.
 */
export function fakeServer(handlers: FakeHandlers) {
  const calls: { name: RouteName; call: FakeCall }[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    const matcher = MATCHERS.find(
      ({ method, pattern }) => method === request.method && pattern.test(pathname),
    );

    if (!matcher) return refusal({ status: 404, code: 'not_found', message: 'No such route' });

    const values = matcher.pattern.exec(pathname)?.slice(1) ?? [];
    const params = Object.fromEntries(
      matcher.params.map((param, index) => [param, values[index] ?? '']),
    );
    const text = await request.text();
    const call = { params, body: text ? (JSON.parse(text) as unknown) : undefined };

    calls.push({ name: matcher.name, call });

    return answer({ name: matcher.name, call, handlers });
  };

  return { fetch, calls };
}

/** What the fake answers route `name`: its handler's answer, checked, or `not_found`. */
async function answer(params: {
  name: RouteName;
  call: FakeCall;
  handlers: FakeHandlers;
}): Promise<Response> {
  const { name, call, handlers } = params;
  const handler = handlers[name] as ((call: FakeCall) => unknown) | undefined;

  if (!handler) return refusal({ status: 404, code: 'not_found', message: `No fake for ${name}` });

  const route = API_ROUTES[name];

  if ('stream' in route.response) return sse(handler(call) as AsyncIterable<StreamEntry>);

  const result = await handler(call);

  if (result && typeof result === 'object' && 'refuse' in result) {
    return refusal((result as FakeRefusal).refuse);
  }

  if ('schema' in route.response) {
    const schema: z.ZodType = route.response.schema;

    return Response.json(schema.parse(result), { status: route.response.status });
  }

  return new Response(null, { status: 204 });
}
