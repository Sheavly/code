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
 * isn't held up by the disk. A failed write stops the ones behind it and is `failure`, which the
 * owner turns into refusing the conversation's next prompt, so nothing carries on unrecorded;
 * `recover` tries it again, and once it is written `failure` clears.
 */
export class ConversationKeeper {
  readonly #store: ConversationStore;
  readonly #id: ConversationId;
  #index: StoredConversation | undefined;
  #written: Promise<void> = Promise.resolve();
  /** Writes not yet done, oldest first: the failed one stays at the front until it succeeds. */
  readonly #pending: (() => Promise<void>)[] = [];
  #failure: StoreError | undefined;
  readonly #onFailure: ((failure: StoreError) => void) | undefined;
  /** How many entries of the history are queued or written to the log. */
  #kept = 0;
  /** How many entries of each sub-agent's history are queued or written to its log. */
  readonly #agentKept = new Map<SessionId, number>();

  /** `onFailure` is told once each time writes start failing, so the owner can tell a UI. */
  constructor(params: {
    store: ConversationStore;
    id: ConversationId;
    onFailure?: (failure: StoreError) => void;
  }) {
    this.#store = params.store;
    this.#id = params.id;
    this.#onFailure = params.onFailure;
  }

  /** The write that is failing now, if any; cleared when it is written. */
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
   * Resumes a reopened conversation whose log already holds `logged` entries and whose repaired
   * history is `messages`. What `repairHistory` added after the logged entries (a placeholder for
   * a call that never returned) is appended now, once, so log numbers and history positions agree
   * and reopening again finds nothing to repair.
   */
  resumeWith(params: { logged: number; messages: readonly HistoryMessage[] }): void {
    this.#kept = params.logged;

    if (params.messages.length > params.logged) this.keepHistory(params.messages);
  }

  /**
   * The history as it is now: only the entries after those already kept are appended to the log,
   * so nothing stored is rewritten. History only grows; a shorter one is a bug in the caller, and
   * fails the conversation's storage rather than writing over what is there.
   */
  keepHistory(messages: readonly HistoryMessage[]): void {
    const fresh = messages.slice(this.#kept);
    const first = this.#kept;

    if (messages.length < this.#kept) {
      this.#queue(async () => {
        throw new StoreError({
          reason: 'failed',
          message: `History of conversation ${this.#id} shrank from ${String(first)} to ${String(messages.length)} entries`,
        });
      });

      return;
    }

    // A turn that added nothing writes nothing: no empty append, and the index is left alone.
    if (fresh.length === 0) return;

    this.#kept = messages.length;
    this.#queue(async () => {
      await this.#store
        .history({ id: this.#id })
        .append(fresh.map((entry, index) => ({ seq: first + index, entry })));
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

    if (fresh.length === 0) return;

    this.#queue(async () => {
      await this.#store
        .history({ id: this.#id, session })
        .append(fresh.map((entry, index) => ({ seq: first + index, entry })));
    });
  }

  /** Changes what the index says (the title, the model, how the conversation stands). */
  keepIndex(
    change: Partial<Pick<StoredConversation, 'title' | 'modelId' | 'effort' | 'status'>>,
  ): void {
    this.#queue(async () => this.#touchIndex(change));
  }

  async #touchIndex(change: Partial<StoredConversation>): Promise<void> {
    if (!this.#index) return;

    this.#index = { ...this.#index, ...change, updatedAt: now() };
    await this.#store.writeIndex(this.#index);
  }

  /**
   * Tries the failed write again, and the ones queued behind it, in order. Resolves when they are
   * written or one fails again; `failure` says which. The owner calls it before it refuses work
   * over a failure, so a disk that has recovered is not held against the conversation forever.
   */
  recover(): Promise<void> {
    this.#written = this.#written.then(async () => this.#drain());

    return this.#written;
  }

  /**
   * After the writes before it. A failed write stays first in line, so order is never broken, and
   * nothing is tried while it is failing: only `recover` tries again, so a conversation the owner
   * stopped does not quietly turn healthy.
   */
  #queue(write: () => Promise<void>): void {
    this.#pending.push(write);
    this.#written = this.#written.then(async () => {
      if (!this.#failure) await this.#drain();
    });
  }

  #callOnFailure(failure: StoreError): void {
    try {
      this.#onFailure?.(failure);
    } catch (caughtError) {
      queueMicrotask(() => {
        throw caughtError;
      });
    }
  }

  /** Writes what is pending in order, stopping at the first failure; clears `failure` when done. */
  async #drain(): Promise<void> {
    while (this.#pending.length > 0) {
      try {
        await this.#pending[0]?.();
      } catch (caughtError) {
        const first = this.#failure === undefined;

        this.#failure = toStoreError({
          error: caughtError,
          message: `Could not store conversation ${this.#id}`,
        });
        // A throw here must not reject `#written`, which every later write chains on: it fails
        // loudly on its own, like a throwing listener.
        if (first) this.#callOnFailure(this.#failure);

        return;
      }

      this.#pending.shift();
    }

    this.#failure = undefined;
  }
}
