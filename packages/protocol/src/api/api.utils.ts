import { contractDefinitions, contractName } from '../contract/contract.utils.js';
import { serverErrorSchema } from '../server/server.validator.js';
import { API_ROUTES, LAST_EVENT_ID_HEADER, OPENAPI_VERSION } from './api.constants.js';
import type { ApiResponse, ApiRoute, OpenApiDocument } from './api.types.js';

const SCHEMAS = '#/components/schemas/';

/** A `$ref` to the contract's schema; a schema the contract doesn't name fails loudly. */
function refTo(schema: Parameters<typeof contractName>[0]): { $ref: string } {
  const name = contractName(schema);

  if (!name) throw new TypeError('An API route uses a schema the contract doesn’t name');

  return { $ref: `${SCHEMAS}${name}` };
}

/** A route's success answer in OpenAPI: JSON, nothing, or an SSE stream of items. */
function successOf(response: ApiResponse): Record<string, unknown> {
  if ('schema' in response) {
    return {
      description: 'Success',
      content: { 'application/json': { schema: refTo(response.schema) } },
    };
  }

  if ('stream' in response) {
    // OpenAPI 3.2's `itemSchema`: each SSE event's data is one item.
    return {
      description: 'Server-sent events, one `entry` per stream entry',
      content: { 'text/event-stream': { itemSchema: refTo(response.stream) } },
    };
  }

  return { description: 'Done' };
}

/** The params of `route`: each `{param}` in its path, and `Last-Event-ID` for a stream it resumes. */
function parametersOf(route: ApiRoute): Record<string, unknown>[] {
  const names = [...route.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  const pathParams = names.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));

  if (route.method !== 'query') return pathParams;

  return [
    ...pathParams,
    { name: LAST_EVENT_ID_HEADER, in: 'header', required: false, schema: { type: 'string' } },
  ];
}

/** One route as an OpenAPI operation: its params, body, success and the shared error. */
function operationOf(params: { operationId: string; route: ApiRoute }): Record<string, unknown> {
  const { operationId, route } = params;
  const error = {
    description: 'Refused: its `code` says why',
    content: { 'application/json': { schema: refTo(serverErrorSchema) } },
  };

  return {
    operationId,
    summary: route.summary,
    parameters: parametersOf(route),
    ...(route.body && {
      requestBody: {
        required: true,
        content: { 'application/json': { schema: refTo(route.body) } },
      },
    }),
    responses: { [String(route.response.status)]: successOf(route.response), default: error },
  };
}

/**
 * The API as an OpenAPI 3.2 document, for clients and generators: every route, the bearer token
 * they all need, and the contract's schemas as components.
 */
export function openApiDocument(): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};

  for (const [operationId, route] of Object.entries(API_ROUTES)) {
    paths[route.path] = {
      ...paths[route.path],
      [route.method]: operationOf({ operationId, route }),
    };
  }

  return {
    openapi: OPENAPI_VERSION,
    info: { title: 'Sheavly harness', version: '0.0.0' },
    paths,
    components: {
      schemas: contractDefinitions(SCHEMAS),
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    },
    security: [{ bearer: [] }],
  };
}
