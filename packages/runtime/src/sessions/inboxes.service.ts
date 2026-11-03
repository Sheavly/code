import type { InboxMessage, SessionId } from '@sheavly/protocol/session/session.types';

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

  has(id: SessionId): boolean {
    return (this.#messages.get(id)?.length ?? 0) > 0;
  }

  /** Resolves when a message arrives for the session, or it is woken (it ended). */
  next(id: SessionId): Promise<void> {
    return new Promise((resolve) => {
      this.#waiters.set(id, [...(this.#waiters.get(id) ?? []), resolve]);
    });
  }

  /** Wakes every loop waiting on the session's inbox. */
  wake(id: SessionId): void {
    const waiters = this.#waiters.get(id) ?? [];

    this.#waiters.delete(id);
    waiters.forEach((wake) => wake());
  }
}
