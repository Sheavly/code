import { z } from 'zod';
import { lowercaseUuidSchema } from '../id/id.validator.js';

/**
 * The stable reference to one command's complete captured output. Branded, so it can't be passed
 * where another id goes. It names a log inside one conversation, never a path.
 */
export const outputRefSchema = lowercaseUuidSchema.brand<'OutputRef'>();

/**
 * Whether a log can be trusted to hold everything the command printed. `capturing`: the command
 * still runs and more may come. `complete`: the command ended and nothing was lost. `incomplete`:
 * something was lost (storage failed, a limit was reached, the capture ended without a record),
 * so `reason` says what; what is stored is a prefix of the output, never presented as all of it.
 */
export const outputStatusSchema = z.enum(['capturing', 'complete', 'incomplete']);

/** What is known about one log: its reference, the bytes stored so far and its completeness. */
export const outputLogSchema = z.object({
  ref: outputRefSchema,
  /** Bytes of captured stdout and stderr stored so far (UTF-8). */
  bytes: z.number().int().nonnegative(),
  status: outputStatusSchema,
  reason: z.string().exactOptional(),
});
