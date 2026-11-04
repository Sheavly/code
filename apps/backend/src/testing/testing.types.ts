/** Test-only: a request to a test API, as a client sends it (the token is added for it). */
export type TestRequest = { method?: string; body?: unknown; headers?: Record<string, string> };
