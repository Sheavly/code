import { HTTPException } from 'hono/http-exception';
import { ConversationsError } from '@sheavly/host/errors/conversations.errors';
import { ApprovalRequestError } from '@sheavly/runtime/errors/approvals.errors';
import { SessionError } from '@sheavly/runtime/errors/sessions.errors';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { ServerFailure } from './server.types.js';

/**
 * How the server answers `error`: the caller's mistakes by their protocol code, and anything else
 * as `internal`, without its message (it can hold paths or a provider's reply, never for a client).
 */
export function toServerFailure(error: unknown): ServerFailure {
  if (error instanceof HTTPException) {
    return error.status === 401
      ? { status: 401, code: 'unauthorized', message: 'A valid bearer token is required' }
      : { status: 400, code: 'bad_request', message: error.message };
  }

  if (error instanceof ConversationsError) {
    return error.reason === 'not_found'
      ? { status: 404, code: 'not_found', message: error.message }
      : { status: 422, code: 'unknown_skill', message: error.message };
  }

  if (error instanceof SessionError && error.reason === 'session_running') {
    return { status: 409, code: 'session_running', message: error.message };
  }

  if (error instanceof SessionError && error.reason === 'session_ended') {
    return { status: 404, code: 'not_found', message: error.message };
  }

  if (error instanceof ApprovalRequestError) {
    return { status: 404, code: 'unknown_approval', message: error.message };
  }

  return { status: 500, code: 'internal', message: 'The server failed; see its log' };
}

/**
 * Whether a stream sends `entry`: after `lastEventId` (a client resuming, `Last-Event-ID` is the
 * last `seq` it got), and anything at all without one.
 */
export function isAfter(params: { entry: StreamEntry; lastEventId: number | undefined }): boolean {
  const { entry, lastEventId } = params;

  return lastEventId === undefined || entry.seq > lastEventId;
}

/** The `Last-Event-ID` header as an entry's `seq`, or undefined when absent or not a number. */
export function parseLastEventId(header: string | undefined): number | undefined {
  if (header === undefined || !/^\d+$/.test(header.trim())) return undefined;

  return Number(header.trim());
}
