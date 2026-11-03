import type { z } from 'zod';
import type { requestPolicySchema } from './adapter-config.validator.js';

/**
 * How a call is sent. `responseTimeoutMs`: how long to wait for the response headers (not the
 * whole reply: a long answer streams for as long as it takes). `retries`: how many more times a
 * call is sent when it fails before anything streamed (a network error, that timeout, HTTP 429
 * or 5xx); never after, since the turn may have started tools. `retryDelayMs`: the first wait
 * between attempts, doubled each time (or the server's `retry-after`, if longer; one over a
 * minute isn't waited for, and the error is reported instead).
 */
export type RequestPolicy = z.infer<typeof requestPolicySchema>;
