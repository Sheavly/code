/**
 * The last change queued on each file (by real path), shared by every writer and workspace in
 * the process. Tool calls run in parallel, so without it two edits to one file both read the
 * old content and the second write loses the first.
 */
const fileQueues = new Map<string, Promise<void>>();

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
 * Runs `change` (read, change, write) once every change queued earlier on the same real path
 * has finished, so concurrent changes to one file apply one after the other. Changes to
 * different files don't wait for each other. A call aborted while waiting gives up its place
 * without letting later calls skip ahead of the one still running.
 */
export async function withFileLock<T>(params: {
  file: string;
  signal: AbortSignal;
  change: () => Promise<T>;
}): Promise<T> {
  const { file, signal, change } = params;
  const previous = fileQueues.get(file) ?? Promise.resolve();
  const { promise: done, resolve: release } = Promise.withResolvers<undefined>();
  const queued = previous.then(() => done);

  fileQueues.set(file, queued);

  try {
    await waitTurn({ previous, signal });

    return await change();
  } finally {
    release(undefined);
    // Only once every change ahead has finished too: an aborted call gets here while the one
    // ahead may still be running, and dropping the entry then would let the next call skip it.
    void queued.then(() => {
      if (fileQueues.get(file) === queued) fileQueues.delete(file);
    });
  }
}
