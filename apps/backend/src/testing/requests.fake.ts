import type { TestCaller } from './testing.types.js';

/** Test-only: a response's JSON body as an object. */
export const json = async (response: Response) =>
  (await response.json()) as Record<string, unknown>;

/** Test-only: a request with a JSON body to `path` through `api`, by method. */
export const post = (api: TestCaller, path: string, body: unknown) =>
  api.call(path, { method: 'POST', body });
export const put = (api: TestCaller, path: string, body: unknown) =>
  api.call(path, { method: 'PUT', body });
export const query = (api: TestCaller, path: string, body: unknown) =>
  api.call(path, { method: 'QUERY', body });
