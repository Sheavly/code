import path from 'node:path';
import { StoreError } from '@sheavly/core/errors/store.errors';
import type { EntryStore } from '@sheavly/core/store/store.types';
import { streamEntrySchema } from '@sheavly/protocol/stream/stream.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { appendJsonLine, readJsonLines, trimPartialLine } from '../jsonl-file/jsonl-file.helper.js';
import { SerialQueue } from '../serial-queue/serial-queue.service.js';
import { STREAM_FILE } from './conversation-store.constants.js';
import { asStoreError } from './conversation-store.utils.js';

/**
 * One conversation's stream file, `stream.jsonl`: an entry a line, in `seq` order with no gaps.
 *
 * `append` takes only the next `seq`, so a lost write can never be hidden by a later one. What the
 * next `seq` is comes from the file, counted once (the first time it is needed) after a line cut
 * off by a crash is trimmed, and is then kept: appends go one at a time through a queue, so it is
 * the file's. One process owns a conversation's stream; two writing the same file would each
 * count on their own and both think they were next.
 */
export class EntryFile implements EntryStore {
  readonly #file: string;
  readonly #queue = new SerialQueue();
  #next: number | undefined;

  constructor(params: { folder: string }) {
    this.#file = path.join(params.folder, STREAM_FILE);
  }

  async append(entry: StreamEntry): Promise<void> {
    try {
      await this.#queue.run(() => this.#appendNext(entry));
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  async *read(from = 0): AsyncGenerator<StreamEntry> {
    try {
      for await (const entry of readJsonLines({ file: this.#file, schema: streamEntrySchema })) {
        if (entry.seq >= from) yield entry;
      }
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  /**
   * Forgets the count, once the stream's folder is deleted, so a conversation made again under the
   * same id starts from its first entry. Waits for appends already queued.
   */
  async forget(): Promise<void> {
    await this.#queue.run(async () => {
      this.#next = undefined;
    });
  }

  async #appendNext(entry: StreamEntry): Promise<void> {
    const next = await this.#nextSeq();

    if (entry.seq !== next) {
      throw new StoreError({
        reason: 'out_of_order',
        message: `Stream ${this.#file} expected entry ${String(next)}, got ${String(entry.seq)}`,
      });
    }

    try {
      await appendJsonLine({ file: this.#file, value: entry });
    } catch (caughtError) {
      // The line may have reached the file even though the call failed: count it again next time.
      this.#next = undefined;
      throw caughtError;
    }

    this.#next = next + 1;
  }

  /** The `seq` the next entry must have: counted from the file the first time, then kept. */
  async #nextSeq(): Promise<number> {
    if (this.#next !== undefined) return this.#next;

    // A line cut off by a crash would have the next entry joined onto it, so it goes first.
    await trimPartialLine({ file: this.#file });

    let count = 0;

    for await (const entry of readJsonLines({ file: this.#file, schema: streamEntrySchema })) {
      if (entry.seq !== count) {
        throw new StoreError({
          reason: 'failed',
          message: `Stream ${this.#file} skips from ${String(count)} to ${String(entry.seq)}`,
        });
      }

      count += 1;
    }

    this.#next = count;

    return count;
  }
}
