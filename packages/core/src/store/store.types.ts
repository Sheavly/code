import type { OutputStore } from '../output/output.types.js';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { HistoryRecord } from '@sheavly/protocol/history/history.types';
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
 * One session's durable history: an append-only log of entries, each with a permanent `seq`
 * starting at 0 with no gaps. `append` takes the next records in order and rejects with a
 * `StoreError` for any other `seq`, so a lost write can never be hidden by a later one; a crash
 * may keep only the first records of one `append`, never a gap. `read` yields the records from
 * `from` (default 0). Entries are never rewritten or removed.
 */
export type HistoryLog = {
  append(records: readonly HistoryRecord[]): Promise<void>;
  read(from?: number): AsyncIterable<HistoryRecord>;
};

/**
 * One JSON document kept with a conversation, for an owner that knows what is in it and keeps its
 * own schema. `load` gives what is stored, `undefined` when nothing is. `update` replaces it with
 * what `change` makes of the current one, one change at a time, so two agents changing it at once
 * never erase each other; `change` returning `undefined` stores nothing. Either rejects with a
 * `StoreError` when storage fails.
 */
export type DocumentStore = {
  load(): Promise<unknown>;
  update(change: (current: unknown) => unknown): Promise<void>;
};

/**
 * Where a user's past conversations are kept: generic (no workspace, no coding tool), so any
 * harness project can keep its chats. Every method rejects with a `StoreError` when storage fails.
 */
export type ConversationStore = {
  /** Conversation `id`'s entries; the conversation exists in the store from its first `append`. */
  entries(id: ConversationId): EntryStore;
  /**
   * The durable history log of conversation `id`'s main session, or of sub-agent `session`'s when
   * given. `session` is an id the registry made; a store that names a file after it must refuse
   * one that is not safe to use as a name rather than trust it.
   */
  history(params: { id: ConversationId; session?: SessionId | undefined }): HistoryLog;
  /**
   * Conversation `id`'s shell state (`shell.json`): where its agents work from. The same document
   * for every call with one `id`, so the main session and its sub-agents share it, and kept with
   * the conversation, so it survives a restart and goes when the conversation is deleted.
   */
  shell(id: ConversationId): DocumentStore;
  /**
   * Conversation `id`'s complete command output. Kept with the conversation, so it survives a
   * reopen and goes when the conversation is deleted; another conversation's references are
   * `not_found` in it.
   */
  outputs(id: ConversationId): OutputStore;
  /**
   * Conversation `id`'s pending queue (`queue.json`): lines a person queued behind a running
   * prompt. Kept apart from history so it never reaches model input or summaries, and survives a
   * restart; reopening never sends it. Goes when the conversation is deleted.
   */
  queue(id: ConversationId): DocumentStore;
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
