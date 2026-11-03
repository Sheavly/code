import { hc } from 'hono/client';
import type { ServerApp } from '../server/server.types.js';

/**
 * A typed client for a harness server: every route's request and response typed from the routes
 * themselves (`hc<ServerApp>`), so a TypeScript UI can't send a wrong body. The token goes in a
 * header on every request. SSE bodies (a prompt, the stream) are read as streams; parse each
 * `entry` frame with `streamEntrySchema`.
 */
export function createServerClient(params: { url: string; token: string; fetch?: typeof fetch }) {
  const { url, token } = params;

  return hc<ServerApp>(url, {
    headers: { authorization: `Bearer ${token}` },
    ...(params.fetch && { fetch: params.fetch }),
  });
}
