import { z } from 'zod';

// Config pieces the built-in adapters share. Each adapter adds its own defaults.

/** A base URL, without trailing slashes. */
export const baseUrlSchema = z.url().transform((url) => url.replace(/\/+$/, ''));

export const apiKeySchema = z.string().min(1);

/** Keep encrypted reasoning across tool calls. See `ResponsesProviderConfig.reasoning`. */
export const reasoningSchema = z.boolean();

/**
 * How a call is sent: how long to wait for the response to start, and how often to retry one
 * that failed before anything streamed. Required, with no defaults: like the model, it is the
 * caller's choice. See `RequestPolicy`.
 */
export const requestPolicySchema = z.object({
  responseTimeoutMs: z.number().int().positive(),
  retries: z.number().int().min(0).max(10),
  retryDelayMs: z.number().int().min(0),
});
