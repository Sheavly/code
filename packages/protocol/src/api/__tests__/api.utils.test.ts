import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ROUTES, OPENAPI_FILE } from '../api.constants.js';
import { openApiDocument } from '../api.utils.js';
import { refsIn } from '../../testing/refs.fake.js';

const PACKAGE_ROOT = join(import.meta.dirname, '../../..');

describe('openApiDocument', () => {
  it('matches the committed openapi.json (rerun `npm run schema -w @sheavly/protocol`)', async () => {
    const committed: unknown = JSON.parse(await readFile(join(PACKAGE_ROOT, OPENAPI_FILE), 'utf8'));

    expect(committed).toEqual(openApiDocument());
  });

  it('has one operation per route, named after it, under its path and method', () => {
    const { paths } = openApiDocument();

    for (const [operationId, route] of Object.entries(API_ROUTES)) {
      expect(paths[route.path]?.[route.method]).toMatchObject({ operationId });
    }
  });

  it('names each route after what it does: get/query/list for a read, a verb for a change', () => {
    for (const [operationId, route] of Object.entries(API_ROUTES)) {
      const reads = /^(get|query|list|stream)[A-Z]/.test(operationId);

      expect({ operationId, reads }).toEqual({ operationId, reads: route.effect === 'read' });
    }
  });

  it('gives each path at most one route per method, and every path param a name', () => {
    const seen = new Set<string>();

    for (const route of Object.values(API_ROUTES)) {
      const key = `${route.method} ${route.path}`;

      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(route.path).toMatch(/^\/conversations(\/(\{[a-z]+\}|[a-z-]+))*$/);
    }
  });

  it('describes the streams as server-sent events of stream entries, and QUERY as its own method', () => {
    const { paths } = openApiDocument();
    const stream = {
      'text/event-stream': { itemSchema: { $ref: '#/components/schemas/StreamEntry' } },
    };

    expect(paths['/conversations/{id}/prompts']?.post).toMatchObject({
      responses: { 200: { content: stream } },
    });
    expect(paths['/conversations/{id}/stream']?.query).toMatchObject({
      responses: { 200: { content: stream } },
    });
  });

  it('only references schemas it defines', () => {
    const document = openApiDocument();
    const names = refsIn(document).map((ref) => ref.replace('#/components/schemas/', ''));

    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !(name in document.components.schemas))).toEqual([]);
  });
});
