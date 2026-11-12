import type { ConversationStore } from '@sheavly/core/store/store.types';
import { now } from '@sheavly/core/clock/clock.helper';
import { toStoreError } from '@sheavly/core/store/store.utils';
import { StoreError } from '@sheavly/core/errors/store.errors';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { StoredConversation } from '@sheavly/protocol/store/store.types';

/**
 * Keeps one conversation's history log and index entry in its store, as it runs. Writes go one after
 * another, never overtaking each other, and `keepHistory` returns at once: the conversation
 * isn't held up by the disk. The first failed write stops the rest and is `failure`, which the
 * owner turns into refusing the conversation's next prompt, so nothing carries on unrecorded.
 */
export class ConversationKeeper {
  readonly #store: ConversationStore;
  readonly #id: ConversationId;
  #index: StoredConversation | undefined;
  #written: Promise<void> = Promise.resolve();
  #failure: StoreError | undefined;
  /** How many entries of the history are queued or written to the log. */
  #kept = 0;
  /** The log's length minus the history's, for what reopening repaired; 0 otherwise. */
  #offset = 0;
  /** How many entries of each sub-agent's history are queued or written to its log. */
  readonly #agentKept = new Map<SessionId, number>();

  constructor(params: { store: ConversationStore; id: ConversationId }) {
    this.#store = params.store;
    this.#id = params.id;
  }

  /** The first failed write, if any. */
  get failure(): StoreError | undefined {
    return this.#failure;
  }

  /** Resolves once everything queued so far is written (or a write has failed). */
  flush(): Promise<void> {
    return this.#written;
  }

  /** Writes the index entry the conversation starts with (or, reopened, carries on from). */
  begin(conversation: StoredConversation): void {
    this.#index = conversation;
    this.#queue(async () => this.#store.writeIndex(conversation));
  }

  /**
   * Says that a reopened conversation's first `history` entries are already kept, and that the log
   * holds `logged` of them. They differ by the placeholders `repairHistory` made for calls with no
   * result: they are not written, since reopening makes them again the same way, so later entries
   * land in the log that many places before their place in the history.
   */
  resumeAt(params: { logged: number; history: number }): void {
    this.#kept = params.history;
    this.#offset = params.logged - params.history;
  }

  /**
   * The history as it is now: only the entries after those already kept are appended to the log,
   * so nothing stored is rewritten. History only grows; a shorter one is a bug in the caller, and
   * fails the conversation's storage rather than writing over what is there.
   */
  keepHistory(messages: readonly HistoryMessage[]): void {
    const fresh = messages.slice(this.#kept);
    const first = this.#kept;
    const offset = this.#offset;

    if (messages.length < this.#kept) {
      this.#queue(async () => {
        throw new StoreError({
          reason: 'failed',
          message: `History of conversation ${this.#id} shrank from ${String(first)} to ${String(messages.length)} entries`,
        });
      });

      return;
    }

    this.#kept = messages.length;
    this.#queue(async () => {
      await this.#store
        .history({ id: this.#id })
        .append(fresh.map((entry, index) => ({ seq: first + offset + index, entry })));
      await this.#touchIndex({});
    });
  }

  /**
   * A sub-agent's history as it is now: like `keepHistory`, only entries after those already kept
   * go to that session's log. A sub-agent's history is never repaired on reopening, so no offset.
   */
  keepAgentHistory(params: { session: SessionId; messages: readonly HistoryMessage[] }): void {
    const { session, messages } = params;
    const first = this.#agentKept.get(session) ?? 0;

    if (messages.length < first) {
      this.#queue(async () => {
        throw new StoreError({
          reason: 'failed',
          message: `History of sub-agent ${session} in conversation ${this.#id} shrank from ${String(first)} to ${String(messages.length)} entries`,
        });
      });

      return;
    }

    this.#agentKept.set(session, messages.length);

    const fresh = messages.slice(first);

    this.#queue(async () => {
      await this.#store
        .history({ id: this.#id, session })
        .append(fresh.map((entry, index) => ({ seq: first + index, entry })));
    });
  }

  /** Changes what the index says (the title, the model, how the conversation stands). */
  keepIndex(
    change: Partial<Pick<StoredConversation, 'title' | 'modelId' | 'mode' | 'status'>>,
  ): void {
    this.#queue(async () => this.#touchIndex(change));
  }

  async #touchIndex(change: Partial<StoredConversation>): Promise<void> {
    if (!this.#index) return;

    this.#index = { ...this.#index, ...change, updatedAt: now() };
    await this.#store.writeIndex(this.#index);
  }

  /** After the writes before it; once one has failed, no later one is tried. */
  #queue(write: () => Promise<void>): void {
    this.#written = this.#written.then(async () => {
      if (this.#failure) return;

      try {
        await write();
      } catch (caughtError) {
        this.#failure = toStoreError({
          error: caughtError,
          message: `Could not store conversation ${this.#id}`,
        });
      }
    });
  }
}
