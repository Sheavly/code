import { z } from 'zod';

// Config pieces the built-in adapters share. Each adapter adds its own defaults.

/** A base URL, without trailing slashes. */
export const baseUrlSchema = z.url().transform((url) => url.replace(/\/+$/, ''));

export const apiKeySchema = z.string().min(1);

/** Keep encrypted reasoning across tool calls. See `ResponsesConfig.reasoning`. */
export const reasoningSchema = z.boolean();
