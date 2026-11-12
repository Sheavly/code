/**
 * Runs one call at a time per key: a second `run` for a key whose call is still going waits for
 * that call and gets its result, instead of starting another. For work that must not happen twice
 * at once, such as reopening one conversation.
 */
export class InFlight<TKey, TResult> {
  readonly #running = new Map<TKey, Promise<TResult>>();

  /** The running call for `key` if there is one, else `start()`, kept until it settles. */
  async run(params: { key: TKey; start: () => Promise<TResult> }): Promise<TResult> {
    const { key, start } = params;
    const running = this.#running.get(key) ?? start();

    this.#running.set(key, running);

    try {
      return await running;
    } finally {
      // A waiter that resumes late must not drop a newer call registered after this one settled.
      if (this.#running.get(key) === running) this.#running.delete(key);
    }
  }
}
