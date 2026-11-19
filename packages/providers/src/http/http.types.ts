import type { z } from 'zod';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { requestPolicySchema } from './adapter-config.validator.js';

/**
 * What one protocol event means for the shared reader: events to yield now, and `ended` once the
 * event that finishes the reply (`response.completed`, `message_stop`, a finish reason) arrived.
 */
export type ReplyStep = { events?: StreamEvent[]; ended?: true };

/** The protocol-specific parts of reading one reply; `readReply` supplies the rest. */
export type ReplyProtocol<TEvent> = {
  /** Names the API and its end marker in a cut-off error, e.g. `Responses stream ended before response.completed`. */
  cutOffMessage: string;
  /** The typed event for a payload, or undefined for one this protocol does not use. Throws a `ModelApiError` for a known event that is malformed. */
  parse: (raw: unknown) => TEvent | undefined;
  /** Reads one event. Throws a `ModelApiError` for an error event or an invalid reply. */
  step: (event: TEvent) => ReplyStep;
  /** The events that close a reply that ended: replay state, then `done` with stop reason and usage. */
  finish: () => StreamEvent[];
};

/**
 * How a call is sent. `responseTimeoutMs`: how long to wait for the response headers (not the
 * whole reply: a long answer streams for as long as it takes). `retries`: how many more times a
 * call is sent when it fails before anything streamed (a network error, that timeout, HTTP 429
 * or 5xx); never after, since the turn may have started tools. `retryDelayMs`: the first wait
 * between attempts, doubled each time and cut by jitter to between half and all of it (or the
 * server's `retry-after`, in seconds or as an HTTP date, if longer; one over a minute isn't
 * waited for, and the error is reported instead).
 */
export type RequestPolicy = z.infer<typeof requestPolicySchema>;

/**
 * Signs one attempt of a request: given what is about to be sent, returns the headers to add. A
 * signature covers the body and the time, so it is made for every attempt, a retry included, never
 * once up front. The request has plain headers and a string body.
 */
export type RequestSigner = (request: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
}) => Record<string, string>;
