import type { Hook, HookHandlerName } from '@sheavly/core/hook/hook.types';
import { raceAbort } from '../abort/abort.utils.js';
import { HookError, HookTimeoutError } from '../errors/loop.errors.js';
import type { Guarded, OnHookError } from './hooks.types.js';

/**
 * Runs one handler the way every handler is run: raced against the abort, so a hook that ignores
 * its signal cannot hold the run, and with a failure reported through `onHookError` instead of
 * thrown, so one broken hook never stops the run. A failure that is only the run being aborted is
 * not a hook's fault and is not reported. `value` is `undefined` when the abort won the race.
 */
export async function guarded<T>(params: {
  hook: Hook;
  handler: HookHandlerName;
  signal: AbortSignal;
  onHookError: OnHookError;
  work: () => Promise<T>;
}): Promise<Guarded<T>> {
  const { hook, handler, signal, onHookError, work } = params;

  // An already-aborted run starts no handler: `raceAbort` would call `work()` first.
  if (signal.aborted) return { ok: true, value: undefined };

  try {
    return { ok: true, value: await raceAbort({ work: work(), signal }) };
  } catch (caughtError) {
    if (!signal.aborted) {
      onHookError(new HookError({ hook: hook.name, handler, cause: caughtError }));
    }

    return { ok: false, error: caughtError };
  }
}

/** `work`, or a rejection once `timeoutMs` passes; the timer never outlives either. */
export async function withTimeout<T>(params: { work: Promise<T>; timeoutMs: number }): Promise<T> {
  const { work, timeoutMs } = params;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new HookTimeoutError({ timeoutMs })), timeoutMs);
  });

  try {
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
