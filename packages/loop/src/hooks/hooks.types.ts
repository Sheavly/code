import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { HookError } from '../errors/loop.errors.js';

/** A run's failed handlers: `report` as they fail, `deliver` to tell the model at its next call. */
export type HookFailures = {
  report: OnHookError;
  /** Appends a persistent `hook-failed` notice per failed hook handler, and emits it. */
  deliver: (messages: HistoryMessage[]) => void;
};

/** Told about a handler that failed; the loop turns it into `hook_failed` and a model notice. */
export type OnHookError = (failure: HookError) => void;

/** What a guarded handler gave back: its value, or that it failed (already reported). */
export type Guarded<T> = { ok: true; value: T | undefined } | { ok: false; error: unknown };
