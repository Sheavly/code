import type { Deadline } from './process.types.js';

/**
 * The one definition of "timed out" for running commands, shared by a single process and a whole
 * script. No `timeoutMs` means no deadline. The timer belongs to the signal and doesn't keep the
 * process alive.
 */
export function withDeadline(params: {
  signal: AbortSignal;
  timeoutMs?: number | undefined;
}): Deadline {
  const { signal: caller, timeoutMs } = params;

  if (timeoutMs === undefined) return { signal: caller, timedOut: () => false };

  const deadline = AbortSignal.timeout(timeoutMs);

  return {
    signal: AbortSignal.any([caller, deadline]),
    timedOut: () => deadline.aborted && !caller.aborted,
  };
}
