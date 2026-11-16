import { StoreError } from '@sheavly/core/errors/store.errors';
import type { z } from 'zod';
import { appendJsonLine, readJsonLines, trimPartialLine } from '../jsonl-file/jsonl-file.helper.js';
import { SerialQueue } from '../serial-queue/serial-queue.service.js';
import { asStoreError } from './conversation-store.utils.js';

type Numbered = { seq: number };

/**
 * An append-only JSON-lines file of items in `seq` order with no gaps, never rewritten: the one
 * rule behind a conversation's stream and its history logs. The next `seq` is counted from the
 * file once (after a line cut off by a crash is trimmed), then kept; appends go one at a time
 * through a queue, so the count is the file's. `append` takes only the next `seq`, so a lost write
 * can never be hidden by a later one. One process owns a log's file: two writing it would each
 * count on their own and both think they were next.
 *
 * `prepare` runs before the first count (a repair file); `observe` sees each item
 * as it is counted and again as it is appended, so a projection of the log stays in step.
 */
export class AppendLog<T extends Numbered> {
  readonly #file: string;
  readonly #schema: z.ZodType<T>;
  readonly #noun: string;
  readonly #unit: string;
  readonly #prepare: () => Promise<void>;
  readonly #observe: (item: T) => Promise<void>;
  readonly #queue = new SerialQueue();
  #next: number | undefined;
  #afterFailure = false;

  /** `noun` names the log in errors (`Stream`, `History`); `unit` what one item is (`entry`). */
  constructor(params: {
    file: string;
    schema: z.ZodType<T>;
    noun: string;
    unit: string;
    prepare?: () => Promise<void>;
    observe?: (item: T) => Promise<void>;
  }) {
    this.#file = params.file;
    this.#schema = params.schema;
    this.#noun = `${params.noun} ${params.file}`;
    this.#unit = params.unit;
    this.#prepare = params.prepare ?? (async () => undefined);
    this.#observe = params.observe ?? (async () => undefined);
  }

  /** Appends `items`, which must carry the next `seq`s in order; rejects with a `StoreError`. */
  async append(items: readonly T[]): Promise<void> {
    try {
      await this.#queue.run(async () => this.#appendAll(items));
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  /** Waits for appends already queued, then makes sure the log is prepared and counted. */
  async ready(): Promise<void> {
    try {
      await this.#queue.run(async () => this.#nextSeq());
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  /** The items from `from` on, as they are in the file now. */
  async *read(from = 0): AsyncGenerator<T> {
    try {
      for await (const item of readJsonLines({ file: this.#file, schema: this.#schema })) {
        if (item.seq >= from) yield item;
      }
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  /** Forgets the count once the folder is deleted, so a log made again starts from 0. */
  async forget(): Promise<void> {
    await this.#queue.run(async () => {
      this.#next = undefined;
    });
  }

  async #appendAll(requested: readonly T[]): Promise<void> {
    let next = await this.#nextSeq();
    // Right after a failed append, the recount shows which lines did land: a retry of the same
    // items must not be refused for them. Otherwise an old `seq` is out of order, as ever.
    const items = this.#afterFailure ? requested.filter((item) => item.seq >= next) : requested;

    for (const item of items) {
      if (item.seq !== next) {
        throw new StoreError({
          reason: 'out_of_order',
          message: `${this.#noun} expected ${this.#unit} ${String(next)}, got ${String(item.seq)}`,
        });
      }

      next += 1;
    }

    try {
      for (const item of items) {
        await appendJsonLine({ file: this.#file, value: item });
        await this.#observe(item);
      }
    } catch (caughtError) {
      // Some lines may have reached the file even though the call failed: count again next time.
      this.#next = undefined;
      this.#afterFailure = true;
      throw caughtError;
    }

    this.#afterFailure = false;
    this.#next = next;
  }

  /** The `seq` the next item must have: counted from the file the first time, then kept. */
  async #nextSeq(): Promise<number> {
    if (this.#next !== undefined) return this.#next;

    // A line cut off by a crash would have the next item joined onto it, so it goes first.
    await trimPartialLine({ file: this.#file });
    await this.#prepare();

    let count = 0;

    for await (const item of readJsonLines({ file: this.#file, schema: this.#schema })) {
      if (item.seq !== count) {
        throw new StoreError({
          reason: 'failed',
          message: `${this.#noun} skips from ${String(count)} to ${String(item.seq)}`,
        });
      }

      count += 1;
      await this.#observe(item);
    }

    this.#next = count;

    return count;
  }
}
