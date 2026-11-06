import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { API_ROUTES } from '@sheavly/protocol/api/api.constants';
import type { ApiRoute, RouteName } from '@sheavly/protocol/api/api.types';
import { MAX_BODY_BYTES } from './api.constants.js';
import type { ApiHandlers, ApiOptions } from './api.types.js';
import { honoPath, toApiFailure } from './api.utils.js';
import { validJson } from './api.validator.js';
import { apiHandlers, idOf } from './handlers.helper.js';
import { permissionHandlers } from './permission-handlers.helper.js';
import { setupHandlers } from './setup-handlers.helper.js';
import { workspaceHandlers } from './workspace-handlers.helper.js';

/** One route's handler as the app calls it: the table types each one, the app passes it through. */
type AnyHandler = (args: {
  c: Context;
  id: unknown;
  body: unknown;
}) => Response | Promise<Response>;

/** Whether `header` carries `token`, compared in constant time so its length and content don't leak. */
function carriesToken(params: { header: string | undefined; token: string }): boolean {
  const { header, token } = params;
  const given = /^Bearer\s+(\S+)$/.exec(header ?? '')?.[1];

  if (given === undefined) return false;

  const digest = (value: string) => createHash('sha256').update(value).digest();

  return timingSafeEqual(digest(given), digest(token));
}

/** Registers route `name` on `app`: its method and path from the table, its body parsed first. */
function addRoute(params: { app: Hono; name: RouteName; handlers: ApiHandlers }): void {
  const { app, name, handlers } = params;
  const route: ApiRoute = API_ROUTES[name];
  // The table and `ApiHandlers` agree by name; here every handler is called the same way.
  const handle = handlers[name] as AnyHandler;
  const parse: MiddlewareHandler[] = route.body ? [validJson(route.body)] : [];

  app.on(route.method.toUpperCase(), [honoPath(route.path)], ...parse, (c) =>
    handle({
      c,
      // Only the conversation routes have an `:id`; the others read their params themselves.
      id: c.req.param('id') === undefined ? undefined : idOf(c),
      body: route.body ? c.req.valid('json' as never) : undefined,
    }),
  );
}

/**
 * The backend's HTTP API: every route of `API_ROUTES` (method, path and body schema from the
 * contract, its handler from `apiHandlers` and `setupHandlers`), behind a bearer token, with request
 * bodies capped and every failure answered as a `ServerError`. It turns requests into calls on
 * `conversations` and `setup` and adds no behaviour of its own. `serve.ts` decides how to listen
 * and closes the conversations when it stops.
 */
export function createApiApp(options: ApiOptions): Hono {
  const { conversations, setup, workspaces, permissions, token } = options;
  const handlers: ApiHandlers = {
    ...apiHandlers(conversations),
    ...setupHandlers(setup),
    ...workspaceHandlers(workspaces),
    ...permissionHandlers(permissions),
  };
  const app = new Hono()
    .use(
      createMiddleware(async (c, next) => {
        if (!carriesToken({ header: c.req.header('authorization'), token })) {
          throw new HTTPException(401);
        }

        await next();
      }),
    )
    .use(
      bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: () => {
          throw new HTTPException(400, {
            message: `The body is over ${String(MAX_BODY_BYTES)} bytes`,
          });
        },
      }),
    );

  for (const name of Object.keys(API_ROUTES) as RouteName[]) addRoute({ app, name, handlers });

  return app
    .notFound((c) => c.json({ error: { code: 'not_found', message: 'No such route' } }, 404))
    .onError((error, c) => {
      const { status, code, message } = toApiFailure(error);

      return c.json({ error: { code, message } }, status);
    });
}
