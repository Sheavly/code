import path from 'node:path';
import { StoreError } from '@sheavly/core/errors/store.errors';
import { toStoreError } from '@sheavly/core/store/store.utils';
import { lowercaseUuidSchema } from '@sheavly/protocol/id/id.validator';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import { errorMessage } from '@sheavly/runtime/errors/errors.utils';
import {
  AGENT_HISTORY_LOG_SUFFIX,
  AGENTS_FOLDER,
  HISTORY_LOG_FILE,
} from './conversation-store.constants.js';

/**
 * The folder of conversation `id` inside `conversations`. An id is typed, but a type proves nothing
 * about a value that came from outside, so only a lowercase UUID becomes a path: anything else
 * (a separator, `..`) throws a `StoreError` before it can name another folder.
 */
export function conversationFolder(params: { conversations: string; id: ConversationId }): string {
  const { conversations, id } = params;

  if (!lowercaseUuidSchema.safeParse(id).success) {
    throw new StoreError({
      reason: 'failed',
      message: `Conversation id ${JSON.stringify(id)} is not safe to name a folder after: only a lowercase UUID is`,
    });
  }

  return path.join(conversations, id);
}

/** Throws a `StoreError` unless `session` is a lowercase UUID, the only shape that names a file. */
function assertSafeSessionName(session: SessionId): void {
  if (lowercaseUuidSchema.safeParse(session).success) return;

  throw new StoreError({
    reason: 'failed',
    message: `Session id ${JSON.stringify(session)} is not safe to name a file after: only a lowercase UUID is`,
  });
}

/**
 * The file of a session's history log in a conversation's folder: the main session's, or
 * sub-agent `session`'s. A session id is a plain string (a caller may pass its own, like `main`),
 * so only the lowercase UUID the registry makes names a file; anything else (a separator, `..`, a
 * reserved name) throws a `StoreError` before it is a path.
 */
export function historyLogFile(params: { folder: string; session: SessionId | undefined }): string {
  const { folder, session } = params;

  if (session === undefined) return path.join(folder, HISTORY_LOG_FILE);

  assertSafeSessionName(session);

  return path.join(folder, AGENTS_FOLDER, `${session}${AGENT_HISTORY_LOG_SUFFIX}`);
}

/**
 * A storage failure as the `StoreError` a `ConversationStore` is held to. One already raised by
 * the store (an out-of-order entry) is kept as it is. The message names the file that failed and
 * never what it holds: a conversation is private.
 */
export function asStoreError(error: unknown): StoreError {
  return toStoreError({
    error,
    message: `Could not use the stored conversations: ${errorMessage(error)}`,
  });
}
