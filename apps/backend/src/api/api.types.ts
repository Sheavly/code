import type { Context } from 'hono';
import type { Conversations } from '@sheavly/host/conversations/conversations.service';
import type { RouteBody, RouteName } from '@sheavly/protocol/api/api.types';
import type { ConversationId, ServerErrorCode } from '@sheavly/protocol/server/server.types';

/** What the backend's API serves: the live conversations, and the token every request carries. */
export type ApiOptions = {
  /** The live conversations, built the backend's way (`new Conversations({ create })`). */
  conversations: Conversations;
  /** Every request must carry it (`Authorization: Bearer <token>`). Never logged. */
  token: string;
};

/** A failure, as the API answers it: an HTTP status and one of the protocol's codes. */
export type ApiFailure = {
  status: 400 | 401 | 404 | 409 | 422 | 500 | 507;
  code: ServerErrorCode;
  message: string;
};

/** What one route's handler gets: the request, its conversation id, and its parsed body. */
export type HandlerArgs<N extends RouteName> = {
  c: Context;
  id: ConversationId;
  body: RouteBody<N>;
};

/**
 * Every route's handler, by its name in `API_ROUTES`: one call on `conversations` and its result
 * as the route answers it. A route without a handler, or a handler for no route, is a type error.
 */
export type ApiHandlers = {
  [N in RouteName]: (args: HandlerArgs<N>) => Response | Promise<Response>;
};
