import type { Provider } from '@sheavly/core/provider/provider.types';
import type { KeyCheck } from '@sheavly/protocol/model/model.types';
import { ModelApiError } from '../errors/providers.errors.js';
import {
  CHECK_MESSAGES,
  CHECK_RESPONSE_TIMEOUT_MS,
  CHECK_SERVER_ERROR_FROM,
} from './registry.constants.js';
import type { CheckHost, FailedCheck } from './registry.types.js';
import { CHECK_PROMPT } from './registry.prompt.js';
import { checkHttpMessage } from './check-message.utils.js';

/** A failed check with its fixed message. */
const failed = (status: FailedCheck): KeyCheck => ({ status, message: CHECK_MESSAGES[status] });

/** How an HTTP refusal reads as a check: the key, the address, the server, or the request. */
function statusOf(httpStatus: number): FailedCheck {
  if (httpStatus === 401 || httpStatus === 403) return 'invalid';
  if (httpStatus === 404) return 'not_found';

  return httpStatus >= CHECK_SERVER_ERROR_FROM ? 'unreachable' : 'rejected';
}

/**
 * How a failed model call reads as a key check. A refused key (401, 403) is `invalid`; a missing
 * endpoint or deployment (404) is `not_found`; any other refusal (a 400, a rate limit, an error in
 * the reply) is `rejected`; a server failure, a network error, a timeout or a reply cut off is
 * `unreachable`. The message is fixed per status: what the provider said can echo what was sent.
 */
function classifyFailure(params: { error: ModelApiError; host: CheckHost | undefined }): KeyCheck {
  const { error, host } = params;

  switch (error.reason) {
    case 'network':
    case 'timeout':
    case 'cut_off':
      return failed('unreachable');

    case 'http': {
      const status = statusOf(error.status ?? 0);

      return {
        status,
        message:
          checkHttpMessage({ status: error.status ?? 0, message: error.message, host }) ??
          CHECK_MESSAGES[status],
      };
    }

    default:
      return failed('rejected');
  }
}

/**
 * Asks `provider` one tiny question and stops at the first thing it says: if the model answers,
 * the key, the endpoint and the deployment all work. Resolves with how that went, never with what
 * the provider said. `signal` is the caller's way out: aborting it rejects, as any interrupt does.
 * A model that never starts answering within `responseTimeoutMs` is `unreachable`.
 */
export async function checkProvider(params: {
  provider: Provider;
  signal?: AbortSignal | undefined;
  responseTimeoutMs?: number | undefined;
  /** Whose refusals to explain in their own terms; the general messages when omitted. */
  host?: CheckHost | undefined;
}): Promise<KeyCheck> {
  const { provider, signal, responseTimeoutMs = CHECK_RESPONSE_TIMEOUT_MS, host } = params;
  const stop = new AbortController();
  const timer = setTimeout(() => {
    stop.abort();
  }, responseTimeoutMs);

  try {
    const events = provider.stream({
      messages: [{ role: 'user', content: CHECK_PROMPT }],
      tools: [],
      signal: signal ? AbortSignal.any([signal, stop.signal]) : stop.signal,
    });

    for await (const _event of events) return { status: 'valid' };

    // A stream that ended without a single event answered nothing.
    return failed('rejected');
  } catch (caughtError) {
    // The caller's own interrupt is theirs to see; only our timeout is an answer.
    if (signal?.aborted) throw caughtError;
    if (stop.signal.aborted) return failed('unreachable');
    if (caughtError instanceof ModelApiError) return classifyFailure({ error: caughtError, host });
    throw caughtError;
  } finally {
    clearTimeout(timer);
    stop.abort();
  }
}
