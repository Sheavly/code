/**
 * A promise that resolves when the `wake` it hands to `register` is called, or when `signal`
 * aborts. On abort, `unregister` drops `wake` from wherever it was registered, so a caller that
 * gives up leaves nothing behind; when woken normally, the abort listener is taken off the
 * signal, so a long-lived signal does not collect one per wait. A signal that is already aborted
 * resolves at once, without registering.
 */
export function abortableWait(params: {
  signal: AbortSignal | undefined;
  register: (wake: () => void) => void;
  unregister: (wake: () => void) => void;
}): Promise<void> {
  const { signal, register, unregister } = params;

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();

      return;
    }

    const wake = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      unregister(wake);
      resolve();
    };

    register(wake);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
