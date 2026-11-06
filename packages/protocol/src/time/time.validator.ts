import { z } from 'zod';

/**
 * When something happened, in milliseconds since the epoch (as `startedAt` and `sentAt` are).
 * Whole milliseconds, never negative.
 */
export const timestampSchema = z.number().int().nonnegative();
