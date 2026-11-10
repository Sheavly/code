import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
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
  /**
   * The history conversation `id` continues from: the messages as last written, `[]` when none
   * were. Entries can't rebuild it (a prompt is not an entry, and a reply arrives in pieces), so
   * the owner of the conversation writes it whole.
   */
  readMessages(id: ConversationId): Promise<HistoryMessage[]>;
  /** Replaces conversation `id`'s history with `messages`. */
  writeMessages(params: { id: ConversationId; messages: readonly HistoryMessage[] }): Promise<void>;
  /**
   * The history of sub-agent `session` in conversation `id`, as last written, `[]` when none was:
   * what a sub-agent that finished continues from when its parent follows up with it. Each
   * sub-agent has its own, apart from the conversation's (`readMessages`) and from every other
   * sub-agent's. Written whole by the owner, like the conversation's, for the same reason.
   * `session` is an id the registry made; a store that names a file after it must refuse one that
   * is not safe to use as a name rather than trust it.
   */
  readAgentMessages(params: { id: ConversationId; session: SessionId }): Promise<HistoryMessage[]>;
  /** Replaces sub-agent `session`'s history in conversation `id` with `messages`. */
  writeAgentMessages(params: {
    id: ConversationId;
    session: SessionId;
    messages: readonly HistoryMessage[];
  }): Promise<void>;
  /** Every stored conversation's index entry, oldest first. */
  list(): Promise<StoredConversation[]>;
  /** Writes `conversation`'s index entry, replacing the one stored for its `id`. */
  writeIndex(conversation: StoredConversation): Promise<void>;
  /**
   * Removes the conversation, its entries, its history, its sub-agents' histories and its index
   * entry. A conversation not stored is fine.
   */
  delete(id: ConversationId): Promise<void>;
};
