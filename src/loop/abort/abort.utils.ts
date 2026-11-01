/**
 * Helpers for stopping cleanly on an AbortSignal, even when the thing being awaited
 * (a provider stream, a tool) doesn't honour the signal itself.
 */

/** Resolves when `signal` aborts (immediately if it already has). Never rejects. */
export function whenAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true }),
  );
}

const ABORTED: unique symbol = Symbol('aborted');

/** For `.catch(ignoreRejection)`: the rejection is handled elsewhere or no longer matters. */
export function ignoreRejection(): undefined {
  return undefined;
}

/**
 * Iterates `source` until it ends or `aborted` resolves, whichever comes first.
 * On abort, iteration stops right away (without waiting for the next item) and the source
 * is told to clean up. Errors thrown by the source after the abort are ignored.
 */
export async function* untilAborted<T>(params: {
  source: AsyncIterable<T>;
  aborted: Promise<void>;
}): AsyncGenerator<T> {
  const { source, aborted } = params;
  const iterator = source[Symbol.asyncIterator]();
  const abort = aborted.then((): typeof ABORTED => ABORTED);

  while (true) {
    const next = iterator.next();

    next.catch(ignoreRejection); // if we stop waiting on it, its rejection must not go unhandled

    const result = await Promise.race([next, abort]);

    if (result === ABORTED) {
      iterator.return?.().catch(ignoreRejection);

      return;
    }

    if (result.done) return;
    yield result.value;
  }
}
