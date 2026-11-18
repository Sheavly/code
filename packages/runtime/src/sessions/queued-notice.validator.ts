import { validate } from '@sheavly/core/validation/validation.validator';
import { extensionNoticeSchema } from '@sheavly/protocol/notice/notice.validator';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import { SessionError } from '../errors/sessions.errors.js';
import type { QueuedNotice } from './sessions.types.js';

/**
 * `notice` as the protocol's own extension-notice schema (the member of `persistentNoticeSchema`
 * that history reads back) parses it, so a malformed notice can never enter history through the
 * registry. Throws an `invalid_notice` `SessionError` naming the issue paths and codes, never the
 * values.
 */
export function parseQueuedNotice(params: { id: SessionId; notice: unknown }): QueuedNotice {
  const result = validate({ schema: extensionNoticeSchema, input: params.notice });

  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'} (${issue.code})`)
    .join(', ');

  throw new SessionError({
    reason: 'invalid_notice',
    sessionId: params.id,
    message: `Session ${params.id} refuses a malformed extension notice at ${issues}`,
  });
}
