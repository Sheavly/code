import { z } from 'zod';
import type { CheckOutcome, Observed, RunExpectation } from './check.types.js';

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

// --- Judging a run ---

/** `/…/flags` is a regex; anything else is a plain substring. */
function matches(params: { pattern: string; text: string }): boolean {
  const { pattern, text } = params;
  const regex = /^\/(.+)\/([a-z]*)$/s.exec(pattern);

  if (!regex?.[1]) return text.includes(pattern);

  return new RegExp(regex[1], regex[2]).test(text);
}

/** Problems with the text targets: an expected pattern missing, or a forbidden one present. */
function textProblems(params: {
  wanted: string[] | undefined;
  forbidden: string[] | undefined;
  target: string;
  text: string;
}): string[] {
  const { wanted = [], forbidden = [], target, text } = params;

  return [
    ...wanted.filter((pattern) => !matches({ pattern, text })).map((p) => `${target} lacks ${p}`),
    ...forbidden.filter((pattern) => matches({ pattern, text })).map((p) => `${target} has ${p}`),
  ];
}

/** Problems with the named targets (events, tools): one expected and missing, or forbidden. */
function nameProblems(params: {
  wanted: string[] | undefined;
  forbidden: string[] | undefined;
  target: string;
  seen: readonly string[];
}): string[] {
  const { wanted = [], forbidden = [], target, seen } = params;

  return [
    ...wanted.filter((name) => !seen.includes(name)).map((name) => `no ${name} in ${target}`),
    ...forbidden.filter((name) => seen.includes(name)).map((name) => `${name} in ${target}`),
  ];
}

/** Every expectation `observed` breaks, as readable lines; empty when the run passed. */
export function judgeRun(params: { expectation: RunExpectation; observed: Observed }): string[] {
  const { expectation, observed } = params;
  const { expect: wanted = {}, forbid = {} } = expectation;
  const outcome =
    wanted.outcome && wanted.outcome !== observed.outcome
      ? [`outcome ${observed.outcome}, expected ${wanted.outcome}`]
      : [];

  return [
    ...(['transcript', 'reply'] as const).flatMap((target) =>
      textProblems({
        wanted: wanted[target],
        forbidden: forbid[target],
        target,
        text: observed[target],
      }),
    ),
    ...(['events', 'tools'] as const).flatMap((target) =>
      nameProblems({
        wanted: wanted[target],
        forbidden: forbid[target],
        target,
        seen: observed[target],
      }),
    ),
    ...outcome,
  ];
}

/** True if a change to `file` (repo-relative, `/`-separated) makes a check with `areas` relevant. */
export function touchesAreas(params: {
  areas: readonly string[];
  files: readonly string[];
}): boolean {
  const { areas, files } = params;

  return files.some((file) =>
    areas.some((area) => file === area || file.startsWith(`${area.replace(/\/$/, '')}/`)),
  );
}

/** `workbook/run-sources.json`: which changed files change what a run does. */
export const runSourcesSchema = z.object({
  description: z.string().optional(),
  /** Path prefixes (`src/runtime/`, a file such as `src/demo.ts`). */
  include: z.array(z.string().min(1)).min(1),
  /** Substrings that mark a file as a test or fake, never run source. */
  exclude: z.array(z.string().min(1)),
});

/**
 * True if `file` (repo-relative, `/`-separated) is source a run executes. One list, read by
 * both `workbook check` and the stop hook's nudge, so they agree on what needs a check.
 */
export function isRunSource(params: {
  sources: z.infer<typeof runSourcesSchema>;
  file: string;
}): boolean {
  const { sources, file } = params;

  return (
    sources.include.some((prefix) => file.startsWith(prefix)) &&
    !sources.exclude.some((marker) => file.includes(marker))
  );
}

// --- Reporting ---

/** One line per check, with each failed attempt's problems under it. */
export function formatReport(outcomes: CheckOutcome[]): string {
  const marks = { passed: '✓', passed_on_retry: '~', failed: '✗', interrupted: '⏹' } as const;
  const lines = outcomes.flatMap((outcome) => [
    `${marks[outcome.status]} ${outcome.prompt}  ${outcome.status.replaceAll('_', ' ')}  (runs ${outcome.runs.join(', ')})`,
    ...outcome.attempts.flatMap((problems, index) =>
      problems.map((problem) => `    try ${index + 1}: ${problem}`),
    ),
  ]);

  return [...lines, '', summaryLine(outcomes)].join('\n');
}

/** The last line: stopped, failed, or all passed; only a run of nothing but passes says "passed". */
function summaryLine(outcomes: CheckOutcome[]): string {
  const count = (status: CheckOutcome['status']) =>
    outcomes.filter((outcome) => outcome.status === status).length;

  if (count('interrupted') > 0) {
    return `stopped (Ctrl+C) after ${outcomes.length} check(s): not a pass`;
  }

  const failed = count('failed');

  return failed ? `${failed} of ${outcomes.length} failed` : `all ${outcomes.length} passed`;
}
