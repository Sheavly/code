// How the registry hands what happened to its listeners: frozen, and one at a time, so a listener
// can't change the run's own objects or break the run.

/** Freezes `value` and everything inside it, so whoever gets it can only read it. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }

  return value;
}

/**
 * Calls each listener with `value`. One that throws doesn't stop the others or the caller (a
 * run, for the registry's listeners): its error is rethrown on its own, after this call, so it
 * still fails loudly as an uncaught error.
 */
export function notifyAll<T>(params: { listeners: Iterable<(value: T) => void>; value: T }): void {
  for (const listener of params.listeners) {
    try {
      listener(params.value);
    } catch (caughtError) {
      queueMicrotask(() => {
        throw caughtError;
      });
    }
  }
}
