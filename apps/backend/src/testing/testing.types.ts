/** Test-only: a request to a test API, as a client sends it (the token is added for it). */
export type TestRequest = { method?: string; body?: unknown; headers?: Record<string, string> };

/** Test-only: anything a request helper can send a request through: a test backend's `call`. */
export type TestCaller = {
  call: (path: string, init?: { method?: string; body?: unknown }) => Promise<Response> | Response;
};
