import { BackendError } from '../errors/backend.errors.js';
import { FOLLOWUP_ACCEPTANCE_MS } from './chat.constants.js';

/** Bounds acceptance even when a transport ignores cancellation; late answers cannot replay text. */
export async function waitForFollowupAcceptance(params: {
  text: string;
  signal: AbortSignal;
  send: (text: string, signal: AbortSignal) => Promise<boolean>;
}): Promise<boolean> {
  const timeout = new AbortController();
  const signal = AbortSignal.any([params.signal, timeout.signal]);
  const timer = setTimeout(
    () => timeout.abort(new BackendError({ message: 'Follow-up acceptance timed out.' })),
    FOLLOWUP_ACCEPTANCE_MS,
  );
  const cancelled = Promise.withResolvers<never>();
  const abort = () => cancelled.reject(signal.reason);

  signal.addEventListener('abort', abort, { once: true });

  try {
    signal.throwIfAborted();

    // Racing also observes late rejection from a transport that does not honor its signal.
    return await Promise.race([params.send(params.text, signal), cancelled.promise]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
