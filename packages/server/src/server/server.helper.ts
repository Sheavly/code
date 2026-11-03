import { timingSafeEqual, createHash } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { ServerError } from '@sheavly/protocol/server/server.types';
import { conversationRoutes } from './conversations.routes.js';
import { promptRoutes } from './prompts.routes.js';
import { MAX_BODY_BYTES } from './server.constants.js';
import type { ServerOptions } from './server.types.js';
import { toServerFailure } from './server.utils.js';
import { streamRoutes } from './stream.routes.js';

/** Whether `header` carries `token`, compared in constant time so its length and content don't leak. */
function carriesToken(params: { header: string | undefined; token: string }): boolean {
  const { header, token } = params;
  const given = /^Bearer\s+(\S+)$/.exec(header ?? '')?.[1];

  if (given === undefined) return false;

  const digest = (value: string) => createHash('sha256').update(value).digest();

  return timingSafeEqual(digest(given), digest(token));
}

/**
 * The harness server: every route under `/conversations`, behind a bearer token, with request
 * bodies capped and every failure answered as a `ServerError`. It turns requests into calls on
 * `conversations` and adds no behaviour of its own. The app decides how to listen (Node's
 * `@hono/node-server`, bound to 127.0.0.1 by default) and calls `conversations.closeAll()` when
 * it stops.
 */
export function createServerApp(options: ServerOptions) {
  const { conversations, token } = options;
  const requireToken = createMiddleware(async (c, next) => {
    if (!carriesToken({ header: c.req.header('authorization'), token })) {
      throw new HTTPException(401);
    }

    await next();
  });

  return new Hono()
    .use(requireToken)
    .use(
      bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: () => {
          throw new HTTPException(400, {
            message: `The body is over ${String(MAX_BODY_BYTES)} bytes`,
          });
        },
      }),
    )
    .route('/conversations', conversationRoutes(conversations))
    .route('/conversations', promptRoutes(conversations))
    .route('/conversations', streamRoutes(conversations))
    .notFound((c) =>
      c.json({ error: { code: 'not_found', message: 'No such route' } } satisfies ServerError, 404),
    )
    .onError((error, c) => {
      const { status, code, message } = toServerFailure(error);

      return c.json({ error: { code, message } } satisfies ServerError, status);
    });
}
