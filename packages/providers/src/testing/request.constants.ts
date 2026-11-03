/**
 * Test-only: the request policy tests send calls with. No retries and no wait, so a failure shows
 * at once; a timeout long enough that no fake response ever hits it.
 */
export const TEST_REQUEST = { responseTimeoutMs: 5000, retries: 0, retryDelayMs: 0 } as const;
