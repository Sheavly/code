import path from 'node:path';
import { StoreError } from '@sheavly/core/errors/store.errors';
import { toStoreError } from '@sheavly/core/store/store.utils';
import { lowercaseUuidSchema } from '@sheavly/protocol/id/id.validator';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import { errorMessage } from '@sheavly/runtime/errors/errors.utils';
import { AGENT_HISTORY_SUFFIX, AGENTS_FOLDER } from './conversation-store.constants.js';

/**
 * The folder of conversation `id` inside `conversations`. An id is typed, but a type proves nothing
 * about a value that came from outside, so only a lowercase UUID becomes a path: anything else
 * (a separator, `..`) throws a `StoreError` before it can name another folder.
 */
export function conversationFolder(params: { conversations: string; id: string }): string {
  const { conversations, id } = params;

  if (!lowercaseUuidSchema.safeParse(id).success) {
    throw new StoreError({
      reason: 'failed',
      message: `Conversation id ${JSON.stringify(id)} is not safe to name a folder after: only a lowercase UUID is`,
    });
  }

  return path.join(conversations, id);
}

/**
 * The file of sub-agent `session`'s history in a conversation's folder. A session id is a plain
 * string (a caller may pass its own, like `main`), so it is not trusted to be a file name: only the
 * lowercase UUID the registry makes is one, and anything else (a separator, `..`, a reserved
 * name) throws a `StoreError` before it is a path.
 */
export function agentHistoryFile(params: { folder: string; session: SessionId }): string {
  const { folder, session } = params;

  if (!lowercaseUuidSchema.safeParse(session).success) {
    throw new StoreError({
      reason: 'failed',
      message: `Session id ${JSON.stringify(session)} is not safe to name a file after: only a lowercase UUID is`,
    });
  }

  return path.join(folder, AGENTS_FOLDER, `${session}${AGENT_HISTORY_SUFFIX}`);
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
