import type { ConversationId } from '@sheavly/protocol/server/server.types';

/** Several UIs may switch one conversation; selection writes must finish in request order. */
export class ModelChanges {
  readonly #pending = new Map<ConversationId, Promise<void>>();

  run(params: { id: ConversationId; change: () => Promise<void> }): Promise<void> {
    const previous = this.#pending.get(params.id) ?? Promise.resolve();
    // A failed switch rejects its caller, but must not poison that conversation's next switch.
    const next = previous.then(params.change, params.change);

    this.#pending.set(params.id, next);

    const clear = () => {
      if (this.#pending.get(params.id) === next) this.#pending.delete(params.id);
    };

    void next.then(clear, clear);

    return next;
  }
}
