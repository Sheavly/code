import type { z } from 'zod';
import type {
  checkSchema,
  checkStepSchema,
  runExpectationSchema,
  runSourcesSchema,
} from './check.validator.js';

/** A stored prompt's `check`: what its runs must and must not show, and which areas it covers. */
export type Check = z.infer<typeof checkSchema>;

/** One step of a check: a run with its expectations, or an edit to the workspace. */
export type CheckStep = z.infer<typeof checkStepSchema>;

/** What one run of a check must show (`expect`) and must not (`forbid`). */
export type RunExpectation = z.infer<typeof runExpectationSchema>;

/** `workbook/run-sources.json`: which files change what a run does. */
export type RunSources = z.infer<typeof runSourcesSchema>;

/** What a finished run produced, as a check sees it. */
export type Observed = {
  transcript: string;
  reply: string;
  /** Successful foreground tool output only, never assistant text or failed tool output. */
  toolResults: Readonly<Record<string, string>>;
  /** Failed foreground tool output, including permission and protected-file denials. */
  toolErrors: Readonly<Record<string, string>>;
  /** Event types, in order. */
  events: readonly string[];
  /** Hooks that emitted context_added events, in order. */
  contextHooks: readonly string[];
  /** Tool names, in the order first called. */
  tools: readonly string[];
  outcome: string;
  /** Transport adapter recorded by the backend, never inferred from the model's reply. */
  adapter: string;
};

/**
 * How one check went: passed, passed only on its retry, failed with what broke, or stopped by
 * the user (Ctrl+C), which ends the whole command: no retry, no further checks.
 */
export type CheckOutcome = {
  prompt: string;
  status: 'passed' | 'passed_on_retry' | 'failed' | 'interrupted';
  /** Each attempt's problems, as readable lines (empty for a passing attempt). */
  attempts: string[][];
  /** The runs it made, by id, so `show` and `step` can open them. */
  runs: string[];
};
