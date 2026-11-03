import { ignoreRejection } from '../abort/abort.utils.js';
import type { Sequenced } from './queue.types.js';

/**
 * An ordered, single-consumer event stream.
 *
 * Items are yielded in the order they were enqueued, not the order they resolve: an item
 * enqueued as a promise holds back everything behind it until it resolves. Each item gets a
 * contiguous sequence number (0, 1, 2, ...) at the moment it is released, so `seq` always
 * matches the order a consumer sees.
 *
 * The agent loop sends every event through one of these, which is what keeps tool results
 * in causal order even when they finish early.
 */
export class OrderedQueue<T extends object> implements AsyncIterable<Sequenced<T>> {
  private tail: Promise<void> = Promise.resolve();
  private nextSeq = 0;
  private readonly released: Sequenced<T>[] = [];
  private wake: (() => void) | undefined;
  private closed = false;
  private failure: { error: unknown } | undefined;
  // Backpressure: how many items were enqueued vs. fully handled by the consumer.
  private enqueuedCount = 0;
  private consumedCount = 0;
  private consumerGone = false;
  private readonly waiters: { target: number; resolve: () => void }[] = [];

  enqueue(item: T | Promise<T>): void {
    this.enqueuedCount++;
    const value = Promise.resolve(item);

    value.catch(ignoreRejection); // handled in order below; avoids an "unhandled rejection" while it waits

    this.tail = this.tail.then(async () => {
      if (this.failure) return;

      try {
        this.release({ seq: this.nextSeq++, ...(await value) } as Sequenced<T>);
      } catch (caughtError) {
        this.end({ error: caughtError });
      }
    });
  }

  /** No more items. Iteration ends after everything already enqueued has been yielded. */
  close(): void {
    this.tail = this.tail.then(() => this.end());
  }

  /** End the stream with an error, after everything already enqueued has been yielded. */
  fail(error: unknown): void {
    this.tail = this.tail.then(() => this.end({ error }));
  }

  /**
   * Resolves once the consumer has handled everything enqueued so far, i.e. it has asked for
   * the next item after the last one. Lets a producer wait for the consumer before moving on.
   * Also resolves if the consumer stops iterating or the stream fails.
   */
  consumed(): Promise<void> {
    const target = this.enqueuedCount;

    if (this.consumedCount >= target || this.consumerGone || this.failure) return Promise.resolve();

    return new Promise((resolve) => this.waiters.push({ target, resolve }));
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Sequenced<T>> {
    try {
      while (true) {
        const next = this.released.shift();

        if (next) {
          yield next;
          this.consumedCount++; // resumed: the consumer is done with `next`
          this.settleWaiters();
          continue;
        }

        if (this.failure) throw this.failure.error;
        if (this.closed) return;
        await new Promise<void>((resolve) => (this.wake = resolve));
      }
    } finally {
      this.consumerGone = true;
      this.settleWaiters();
    }
  }

  private settleWaiters(): void {
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];

      if (!waiter) continue;

      if (this.consumerGone || this.failure || this.consumedCount >= waiter.target) {
        this.waiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }

  private release(item: Sequenced<T>): void {
    this.released.push(item);
    this.notify();
  }

  private end(failure?: { error: unknown }): void {
    if (this.closed || this.failure) return;
    if (failure) this.failure = failure;
    else this.closed = true;
    this.notify();
    if (failure) this.settleWaiters();
  }

  private notify(): void {
    const wake = this.wake;

    this.wake = undefined;
    wake?.();
  }
}
