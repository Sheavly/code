import { now } from '@sheavly/core/clock/clock.helper';
import type { ConversationStore } from '@sheavly/core/store/store.types';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import { ConversationsError } from '../errors/conversations.errors.js';
import type { StoredConversationState } from './conversations.types.js';
import { repairHistory } from './conversations.utils.js';

/**
 * Reads everything reopening conversation `id` needs from `store`. Throws `not_found` when the
 * store has no such conversation, and a `StoreError` when its entries have a gap.
 */
export async function readStoredConversation(params: {
  store: ConversationStore;
  id: ConversationId;
}): Promise<StoredConversationState> {
  const { store, id } = params;
  const stored = (await store.list()).find((conversation) => conversation.id === id);

  if (!stored) {
    throw new ConversationsError({
      reason: 'not_found',
      message: `No stored conversation ${id}: it was deleted, or never kept`,
    });
  }

  return {
    stored,
    messages: repairHistory({ messages: await store.readMessages(id), at: now() }),
    resume: await SessionRegistry.readStoredLog(store.entries(id)),
  };
}
