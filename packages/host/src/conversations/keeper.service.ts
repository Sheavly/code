import type { ConversationStore } from '@sheavly/core/store/store.types';
import { now } from '@sheavly/core/clock/clock.helper';
import { toStoreError } from '@sheavly/core/store/store.utils';
import type { StoreError } from '@sheavly/core/errors/store.errors';
import type { HistoryMessage } from '@sheavly/protocol/message/message.types';
import type { ConversationId } from '@sheavly/protocol/server/server.types';
import type { StoredConversation } from '@sheavly/protocol/store/store.types';

/**
 * Keeps one conversation's history and index entry in its store, as it runs. Writes go one after
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

  /** The history as it is now: whole, replacing the one stored. */
  keepHistory(messages: readonly HistoryMessage[]): void {
    this.#queue(async () => {
      await this.#store.writeMessages({ id: this.#id, messages });
      await this.#touchIndex({});
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
