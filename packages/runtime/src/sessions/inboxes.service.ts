import type { InboxMessage, SessionId } from '@sheavly/protocol/session/session.types';
import { abortableWait } from '../wait/abortable-wait.helper.js';

/**
 * Each session's inbox: the messages queued for its next model call, and the loops waiting idle
 * (for tasks) that a new message should wake. Who may send what is the registry's to check.
 */
export class Inboxes {
  #messages = new Map<SessionId, InboxMessage[]>();
  #waiters = new Map<SessionId, (() => void)[]>();

  /** Queues `message` for `id`, oldest first, and wakes a loop waiting for one. */
  add(params: { id: SessionId; message: InboxMessage }): void {
    const { id, message } = params;

    this.#messages.set(id, [...(this.#messages.get(id) ?? []), message]);
    this.wake(id);
  }

  /** Removes and returns the session's queued messages, oldest first. */
  take(id: SessionId): InboxMessage[] {
    const messages = this.#messages.get(id) ?? [];

    this.#messages.delete(id);

    return messages;
  }

  /** Drops the session's queued messages and wakes anyone waiting on it, for a released session. */
  forget(id: SessionId): void {
    this.#messages.delete(id);
    this.wake(id);
  }

  has(id: SessionId): boolean {
    return (this.#messages.get(id)?.length ?? 0) > 0;
  }

  /**
   * Resolves when a message arrives for the session, or it is woken (it ended). When `signal`
   * aborts, the wait is dropped from the inbox and resolves too, so a caller that gives up on it
   * leaves nothing behind.
   */
  next(id: SessionId, signal?: AbortSignal): Promise<void> {
    return abortableWait({
      signal,
      register: (wake) => this.#waiters.set(id, [...(this.#waiters.get(id) ?? []), wake]),
      unregister: (wake) => this.#dropWaiter({ id, waiter: wake }),
    });
  }

  /** How many loops wait on the session's inbox. */
  waiting(id: SessionId): number {
    return this.#waiters.get(id)?.length ?? 0;
  }

  #dropWaiter(params: { id: SessionId; waiter: () => void }): void {
    const remaining = (this.#waiters.get(params.id) ?? []).filter((w) => w !== params.waiter);

    if (remaining.length === 0) this.#waiters.delete(params.id);
    else this.#waiters.set(params.id, remaining);
  }

  /** Wakes every loop waiting on the session's inbox. */
  wake(id: SessionId): void {
    const waiters = this.#waiters.get(id) ?? [];

    this.#waiters.delete(id);
    waiters.forEach((wake) => wake());
  }
}
