import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';

/**
 * The entries a stream has still to write, bounded so one slow consumer cannot make the server
 * hold a whole conversation in memory. The bound counts live entries (`seq` from `liveFrom`), not
 * a replay of history, which is as large as the log and is what a client resuming after a long gap
 * asks for. Past `limit` waiting live entries the consumer is cut off: the queue is emptied and
 * refuses more (`overflowed`), and the stream ends. Nothing is lost for a client that reconnects
 * with `Last-Event-ID`, because the entries it missed are replayed from the log.
 */
export class EntryQueue {
  readonly #entries: StreamEntry[] = [];
  readonly #limit: number;
  readonly #liveFrom: number;
  #live = 0;
  #overflowed = false;

  constructor(params: { limit: number; liveFrom: number }) {
    this.#limit = params.limit;
    this.#liveFrom = params.liveFrom;
  }

  /** Whether the consumer fell more than `limit` live entries behind and was cut off. */
  get overflowed(): boolean {
    return this.#overflowed;
  }

  /** Adds an entry. Returns false, and drops everything waiting, when live ones pass the limit. */
  push(entry: StreamEntry): boolean {
    if (this.#overflowed) return false;

    if (entry.seq >= this.#liveFrom) this.#live += 1;

    if (this.#live > this.#limit) {
      this.#overflowed = true;
      this.#entries.length = 0;

      return false;
    }

    this.#entries.push(entry);

    return true;
  }

  /** The oldest entry waiting, if any. */
  shift(): StreamEntry | undefined {
    const entry = this.#entries.shift();

    if (entry && entry.seq >= this.#liveFrom) this.#live -= 1;

    return entry;
  }
}
