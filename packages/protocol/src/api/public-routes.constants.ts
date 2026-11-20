import {
  handshakeRequestSchema,
  handshakeResponseSchema,
} from '../handshake/handshake.validator.js';
import { healthResponseSchema } from '../version/version.validator.js';
import type { ApiRoute } from './api.types.js';

/**
 * The routes that answer without the bearer token, part of `API_ROUTES`: they only identify the
 * server (that Sheavly runs, its two versions, and a proof that it holds the token and is one
 * instance), and reveal nothing of the user's data. A route is private unless it says
 * `public: true`; adding one here is a visible change the backend's `public-routes.test.ts` pins.
 */
export const PUBLIC_ROUTES = {
  getHealth: {
    effect: 'read',
    method: 'get',
    path: '/health',
    public: true,
    summary: 'Whether the server is up, its server version and its protocol version',
    response: { status: 200, schema: healthResponseSchema },
  },
  queryHandshake: {
    effect: 'read',
    method: 'query',
    path: '/handshake',
    public: true,
    summary:
      'Prove the server holds the token and is this instance, for a nonce, without sending the token',
    body: handshakeRequestSchema,
    response: { status: 200, schema: handshakeResponseSchema },
  },
} as const satisfies Record<string, ApiRoute>;
