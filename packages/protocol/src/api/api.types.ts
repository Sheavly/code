import type { z } from 'zod';

/** An HTTP method a route uses; `query` is RFC 10008's QUERY (a read with a body). */
export type ApiMethod = 'get' | 'post' | 'put' | 'delete' | 'query';

/**
 * What a route answers on success: JSON in `schema`, nothing (`204`), or a server-sent event
 * stream whose every `entry` frame's data is one `stream` value.
 */
export type ApiResponse =
  { status: 200 | 201; schema: z.ZodType } | { status: 204 } | { status: 200; stream: z.ZodType };

/**
 * One route of the harness's HTTP API: what a server implements and a client calls. `path` uses
 * OpenAPI's `{param}` form; its params are strings. Every route needs the bearer token and fails
 * with a `ServerError` body.
 */
export type ApiRoute = {
  method: ApiMethod;
  path: string;
  summary: string;
  body?: z.ZodType;
  response: ApiResponse;
};

/** The API as an OpenAPI 3.2 document: the routes, and the contract's schemas as components. */
export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, z.core.JSONSchema.BaseSchema>;
    securitySchemes: Record<string, unknown>;
  };
  security: Record<string, string[]>[];
};
