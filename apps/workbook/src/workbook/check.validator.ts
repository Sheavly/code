import { z } from 'zod';

// What a stored prompt's `check` and `workbook/run-sources.json` may contain.

/** One expected piece of text: a substring, or a regex written `/…/flags`. */
const patternSchema = z.string().min(1);

/** Where a run's output is looked at: what was printed, the final reply, events, tools. */
const textTargetsSchema = z.strictObject({
  transcript: z.array(patternSchema).optional(),
  reply: z.array(patternSchema).optional(),
  /** Event types (`context_added`, `tool_result`, ...). */
  events: z.array(z.string().min(1)).optional(),
  /** Tool names (`read_file`, `run_command`, ...). */
  tools: z.array(z.string().min(1)).optional(),
});

/** What one run of a check must show (`expect`) and must not (`forbid`). */
export const runExpectationSchema = z.strictObject({
  expect: textTargetsSchema
    .extend({ outcome: z.enum(['completed', 'interrupted', 'max_turns', 'failed']).optional() })
    .optional(),
  forbid: textTargetsSchema.optional(),
});

/**
 * One step of a check: a run of the prompt (with its flags), an edit to the run's workspace
 * between runs (append text to a file), or `untrust` (forget the workspace in the check's own
 * trust store), to set up cases like "changed since trusted" or "never trusted".
 */
export const checkStepSchema = z.union([
  z.strictObject({
    run: z.strictObject({
      keep: z.boolean().default(false),
      trust: z.boolean().default(false),
      /** A different message than the prompt's text. */
      text: z.string().min(1).optional(),
    }),
    ...runExpectationSchema.shape,
  }),
  z.strictObject({ untrust: z.literal(true) }),
  z.strictObject({
    append: z.strictObject({
      /** Relative to the run's workspace; must stay inside it. */
      file: z.string().min(1),
      text: z.string(),
    }),
  }),
]);

/**
 * A stored prompt's check. A single-run check sets `expect` / `forbid` at the top; a check that
 * needs several runs lists `steps`. `areas` are source paths (`src/runtime/trust`) whose changes
 * make it relevant: `check` with no names runs only the ones a branch touched.
 */
export const checkSchema = z
  .strictObject({
    areas: z.array(z.string().min(1)).min(1),
    steps: z.array(checkStepSchema).min(1).optional(),
    ...runExpectationSchema.shape,
  })
  .refine((check) => !(check.steps && (check.expect ?? check.forbid)), {
    message: 'Set expect/forbid at the top for one run, or list steps, not both',
  })
  .refine((check) => Boolean(check.steps ?? check.expect ?? check.forbid), {
    message: 'A check needs expect, forbid or steps',
  });

/** `workbook/run-sources.json`: which changed files change what a run does. */
export const runSourcesSchema = z.object({
  description: z.string().optional(),
  /** Path prefixes (`packages/runtime/src/`, a file such as `apps/terminal/src/demo.ts`). */
  include: z.array(z.string().min(1)).min(1),
  /** Substrings that mark a file as a test or fake, never run source. */
  exclude: z.array(z.string().min(1)),
});
