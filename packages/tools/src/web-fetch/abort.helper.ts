import { WebFetchError } from '../errors/web-fetch.errors.js';

/** Stops waiting even when DNS or an injected dependency cannot itself be cancelled. */
export async function withAbort<T>(params: {
  operation: Promise<T>;
  signal: AbortSignal;
}): Promise<T> {
  const { operation, signal } = params;
  let onAbort: (() => void) | undefined;

  try {
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => reject(new WebFetchError('Web fetch interrupted', { cause: signal.reason }));
      signal.addEventListener('abort', onAbort, { once: true });
      operation.then(resolve, reject);

      if (signal.aborted) onAbort();
    });
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
