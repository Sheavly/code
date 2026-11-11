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
 * Per-file locks for the tools that change files. Tool calls run in parallel, so without them
 * two edits to one file both read the old content and the second write loses the first. One
 * instance is shared by every writer that must not overlap (`createCodingHarness` makes one per
 * harness and gives it to write_file, edit_file, delete_file and the sub-agents' copies); a test
 * makes its own.
 */
export class FileLocks {
  /** The last change queued on each file, by real path. */
  readonly #queues = new Map<string, Promise<void>>();

  /**
   * Runs `change` (read, change, write) once every change queued earlier on the same real path
   * has finished, so concurrent changes to one file apply one after the other. Changes to
   * different files don't wait for each other. A call aborted while waiting gives up its place
   * without letting later calls skip ahead of the one still running.
   */
  async run<T>(params: {
    file: string;
    signal: AbortSignal;
    change: () => Promise<T>;
  }): Promise<T> {
    const { file, signal, change } = params;
    const previous = this.#queues.get(file) ?? Promise.resolve();
    const { promise: done, resolve: release } = Promise.withResolvers<undefined>();
    const queued = previous.then(() => done);

    this.#queues.set(file, queued);

    try {
      await waitTurn({ previous, signal });

      return await change();
    } finally {
      release(undefined);
      // Only once every change ahead has finished too: an aborted call gets here while the one
      // ahead may still be running, and dropping the entry then would let the next call skip it.
      void queued.then(() => {
        if (this.#queues.get(file) === queued) this.#queues.delete(file);
      });
    }
  }

  /** Files with a change running or queued: empty once every change has settled. */
  get busy(): number {
    return this.#queues.size;
  }
}
