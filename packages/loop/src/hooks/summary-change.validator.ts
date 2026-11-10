import { z } from 'zod';
import type { SummaryChange } from '@sheavly/core/hook/hook.types';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { summaryMessageSchema } from '@sheavly/protocol/message/message.validator';
import { SummaryHookError } from '../errors/loop.errors.js';

/**
 * Unknown keys are rejected, so a typo'd `keepToken` doesn't silently do nothing. `satisfies`
 * makes the typecheck fail when this and `SummaryChange` drift apart.
 */
const summaryChangeSchema = z.strictObject({
  keepTokens: z.number().positive().optional(),
  // The checkpoint's own rule: ids unique within one result.
  sections: summaryMessageSchema.shape.sections.optional(),
}) satisfies z.ZodType<SummaryChange>;

/**
 * Turns what a `beforeSummary` hook returned into a change, or throws a `SummaryHookError` naming
 * `hook`. A project hook is plain JavaScript, so nothing about its result is typed. Nothing
 * returned (`undefined`) means no change.
 */
export function parseSummaryChange(params: { input: unknown; hook: string }) {
  const { input, hook } = params;

  return parseOrThrow({
    schema: summaryChangeSchema.optional(),
    input,
    onInvalid: ({ details, error }) =>
      new SummaryHookError({ hook, problem: details, cause: error }),
  });
}
