import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { StoredConversation } from '@sheavly/protocol/store/store.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';

/**
 * One conversation's stored entries, in `seq` order with no gaps. `append` takes the next entry
 * and rejects with a `StoreError` for any other `seq`, so a lost write can never be hidden by a
 * later one. `read` yields the entries from `from` (default 0) on. Either rejects with a
 * `StoreError` when storage fails: a store never drops an entry silently.
 */
export type EntryStore = {
  append(entry: StreamEntry): Promise<void>;
  read(from?: number): AsyncIterable<StreamEntry>;
};

/**
 * Where a user's past conversations are kept: generic (no workspace, no coding tool), so any
 * harness project can keep its chats. Every method rejects with a `StoreError` when storage fails.
 */
export type ConversationStore = {
  /** Conversation `id`'s entries; the conversation exists in the store from its first `append`. */
  entries(id: ConversationId): EntryStore;
  /** Every stored conversation's index entry, oldest first. */
  list(): Promise<StoredConversation[]>;
  /** Writes `conversation`'s index entry, replacing the one stored for its `id`. */
  writeIndex(conversation: StoredConversation): Promise<void>;
  /** Removes the conversation, its entries and its index entry. A conversation not stored is fine. */
  delete(id: ConversationId): Promise<void>;
};
