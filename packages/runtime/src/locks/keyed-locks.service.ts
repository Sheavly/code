/** Resolves when `previous` does, or rejects with the abort reason when `signal` aborts first. */
function waitTurn(params: { previous: Promise<void>; signal: AbortSignal }): Promise<void> {
  const { previous, signal } = params;

  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);

    signal.addEventListener('abort', onAbort, { once: true });
    void previous.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}

/**
 * Locks that serialize changes per key. Calls run in parallel, so without them two changes to one
 * thing both read the old state and the second write loses the first. The key is whatever
 * identifies that thing (the coding tools key it by real path). One instance is shared by every
 * caller that must not overlap; a test makes its own.
 */
export class KeyedLocks {
  /** The last change queued on each key. */
  readonly #queues = new Map<string, Promise<void>>();

  /**
   * Runs `change` (read, change, write) once every change queued earlier on the same `key`
   * has finished, so concurrent changes to one key apply one after the other. Changes to
   * different keys don't wait for each other. A call aborted while waiting gives up its place
   * without letting later calls skip ahead of the one still running.
   */
  async run<T>(params: { key: string; signal: AbortSignal; change: () => Promise<T> }): Promise<T> {
    const { key, signal, change } = params;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const { promise: done, resolve: release } = Promise.withResolvers<undefined>();
    const queued = previous.then(() => done);

    this.#queues.set(key, queued);

    try {
      await waitTurn({ previous, signal });

      return await change();
    } finally {
      release(undefined);
      // Only once every change ahead has finished too: an aborted call gets here while the one
      // ahead may still be running, and dropping the entry then would let the next call skip it.
      void queued.then(() => {
        if (this.#queues.get(key) === queued) this.#queues.delete(key);
      });
    }
  }

  /** Keys with a change running or queued: empty once every change has settled. */
  get busy(): number {
    return this.#queues.size;
  }
}
