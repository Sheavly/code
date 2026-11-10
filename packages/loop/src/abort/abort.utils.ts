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

/**
 * Waits for `work`, or for `signal` to abort, whichever comes first: resolves with undefined on
 * abort, so a caller that checks `signal.aborted` afterwards tells the two apart. For work that may
 * ignore its signal (a hook, a summarizer), which must not hold the run. `work` is attached to the
 * race, so a rejection after the abort is handled and cannot go unhandled. The abort listener is
 * removed once the race settles, so a long-lived run signal does not collect one per call.
 */
export async function raceAbort<T>(params: {
  work: Promise<T>;
  signal: AbortSignal;
}): Promise<T | undefined> {
  const { work, signal } = params;
  const listener = new AbortController();

  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => {
        if (signal.aborted) {
          resolve(undefined);

          return;
        }

        signal.addEventListener('abort', () => resolve(undefined), { signal: listener.signal });
      }),
    ]);
  } finally {
    listener.abort();
  }
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
