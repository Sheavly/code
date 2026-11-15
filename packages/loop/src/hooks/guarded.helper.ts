import type { Hook, HookHandlerName } from '@sheavly/core/hook/hook.types';
import { raceAbort } from '../abort/abort.utils.js';
import { HookError } from '../errors/loop.errors.js';
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

  try {
    return { ok: true, value: await raceAbort({ work: work(), signal }) };
  } catch (caughtError) {
    if (!signal.aborted) {
      onHookError(new HookError({ hook: hook.name, handler, cause: caughtError }));
    }

    return { ok: false, error: caughtError };
  }
}
