import { API_ROUTES, LAST_EVENT_ID_HEADER } from '@sheavly/protocol/api/api.constants';
import type { RouteName } from '@sheavly/protocol/api/api.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { ServerAnswerError, ServerRefusedError } from '../errors/client.errors.js';
import type {
  AnswerOf,
  CallParams,
  ClientOptions,
  EmptyRoute,
  JsonRoute,
  StreamRoute,
} from './client.types.js';
import { parseServerError } from './client.validator.js';
import { readEntries } from './entries.helper.js';

/**
 * A client for a harness server, built from the API's routes (`API_ROUTES`): one call per route,
 * its path params and body typed from the contract's schemas, and every JSON answer parsed with
 * the route's own schema, so ids keep their brands and a server that drifted from the contract
 * fails loudly. A refused request throws `ServerRefusedError` with the server's code.
 */
export function createServerClient(options: ClientOptions) {
  const send = (params: { name: RouteName; call: Record<string, unknown> }) =>
    request({ options, ...params });

  return {
    /** Calls a route that answers JSON, and returns its answer, parsed. */
    async call<N extends JsonRoute>(name: N, call: CallParams<N>): Promise<AnswerOf<N>> {
      const response = await send({ name, call });
      const route = API_ROUTES[name];
      const parsed = route.response.schema.safeParse(await response.json());

      if (!parsed.success) throw new ServerAnswerError({ route: name, cause: parsed.error });

      return parsed.data as AnswerOf<N>;
    },
    /** Calls a route that answers nothing (`204`). */
    async send<N extends EmptyRoute>(name: N, call: CallParams<N>): Promise<void> {
      await send({ name, call });
    },
    /** Opens a route's server-sent event stream: its body, raw, for a UI to save or read. */
    async open<N extends StreamRoute>(
      name: N,
      call: CallParams<N>,
    ): Promise<ReadableStream<Uint8Array>> {
      const response = await send({ name, call });

      if (!response.body) throw new ServerAnswerError({ route: name, cause: 'no body' });

      return response.body;
    },
    /** A route's stream as entries, each parsed with the protocol's schema, to its end. */
    async *stream<N extends StreamRoute>(
      name: N,
      call: CallParams<N>,
    ): AsyncGenerator<StreamEntry> {
      for await (const { entry } of readEntries((await send({ name, call })).body)) yield entry;
    },
  };
}

/** One request to route `name`: its path filled in, its body as JSON, the token as a header. */
async function request(params: {
  options: ClientOptions;
  name: RouteName;
  call: Record<string, unknown>;
}): Promise<Response> {
  const { options, name, call } = params;
  const route = API_ROUTES[name];
  const path = route.path.replace(/\{(\w+)\}/g, (_match, param: string) =>
    encodeURIComponent(String(call[param])),
  );
  const { signal, lastEventId, body } = call as {
    signal?: AbortSignal;
    lastEventId?: number;
    body?: unknown;
  };
  const response = await (options.fetch ?? fetch)(new URL(path, options.url), {
    method: route.method.toUpperCase(),
    headers: {
      authorization: `Bearer ${options.token}`,
      ...('body' in route && { 'content-type': 'application/json' }),
      ...(lastEventId !== undefined && { [LAST_EVENT_ID_HEADER]: String(lastEventId) }),
    },
    ...('body' in route && { body: JSON.stringify(body ?? {}) }),
    ...(signal && { signal }),
  });

  if (response.ok) return response;

  const refused = parseServerError(await response.text());

  throw new ServerRefusedError({
    status: response.status,
    code: refused?.error.code,
    message: refused?.error.message ?? `The server answered ${String(response.status)}`,
  });
}
