import { z } from 'zod';

/** A UI's answer to an approval request, validated before it reaches the waiting tool. */
export const approvalResponseSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }),
  z.object({ decision: z.literal('skip') }),
  z.object({ decision: z.literal('skip_with_message'), message: z.string().trim().min(1) }),
]);
