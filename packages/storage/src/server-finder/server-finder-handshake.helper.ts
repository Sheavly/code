import { HANDSHAKE_TIMEOUT_MS } from './server-finder.constants.js';
import type { FinderVerify, FinderVerifyParams } from './server-finder.types.js';

/**
 * What `verify` answers, or a rejection once `timeoutMs` (`HANDSHAKE_TIMEOUT_MS` when unset) passes:
 * a handshake that never settles must not hang the finder, so the call is raced against a timer
 * and `verify` is told to stop through `signal`. The timer is cleared as soon as either ends.
 */
export async function askHandshake(params: {
  verify: FinderVerify;
  ask: Omit<FinderVerifyParams, 'signal'>;
}): Promise<unknown> {
  const { verify, ask } = params;
  const limit = ask.timeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const failure = new DOMException(
        `The handshake did not answer within ${String(limit)} ms`,
        'TimeoutError',
      );

      controller.abort(failure);
      reject(failure);
    }, limit);
  });

  try {
    return await Promise.race([verify({ ...ask, signal: controller.signal }), expired]);
  } finally {
    clearTimeout(timer);
  }
}
