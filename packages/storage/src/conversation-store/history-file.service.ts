import type { HistoryLog } from '@sheavly/core/store/store.types';
import { StoreError } from '@sheavly/core/errors/store.errors';
import type { HistoryRecord } from '@sheavly/protocol/history/history.types';
import { historyRecordSchema } from '@sheavly/protocol/history/history.validator';
import { readJsonFile } from '../json-file/json-file.helper.js';
import {
  appendJsonLine,
  readJsonLines,
  trimPartialLine,
  writeJsonLines,
} from '../jsonl-file/jsonl-file.helper.js';
import { SerialQueue } from '../serial-queue/serial-queue.service.js';
import { asStoreError } from './conversation-store.utils.js';
import { historySchema } from './conversation-store.validator.js';

/**
 * One session's history log, `history.jsonl`: a record a line, in `seq` order with no gaps, never
 * rewritten. Like `EntryFile`, the next `seq` is counted from the file once (after a line cut off
 * by a crash is trimmed) and then kept, and appends go one at a time through a queue.
 *
 * A history stored whole in `legacyFile` (`history.json`) before logs existed is imported the
 * first time the log is used and the log has no file yet: written in one atomic step, so a crash
 * leaves either no log (imported again next time) or the complete one. The legacy file is left
 * where it is, as the record of what was imported.
 */
export class HistoryFile implements HistoryLog {
  readonly #file: string;
  readonly #legacyFile: string;
  readonly #queue = new SerialQueue();
  #next: number | undefined;

  constructor(params: { file: string; legacyFile: string }) {
    this.#file = params.file;
    this.#legacyFile = params.legacyFile;
  }

  async append(records: readonly HistoryRecord[]): Promise<void> {
    try {
      await this.#queue.run(async () => this.#appendAll(records));
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  async *read(from = 0): AsyncGenerator<HistoryRecord> {
    try {
      await this.#queue.run(async () => this.#prepare());

      for await (const record of readJsonLines({ file: this.#file, schema: historyRecordSchema })) {
        if (record.seq >= from) yield record;
      }
    } catch (caughtError) {
      throw asStoreError(caughtError);
    }
  }

  /** Forgets the count, once the folder is deleted, so a conversation made again starts at 0. */
  async forget(): Promise<void> {
    await this.#queue.run(async () => {
      this.#next = undefined;
    });
  }

  async #appendAll(records: readonly HistoryRecord[]): Promise<void> {
    let next = await this.#prepare();

    for (const record of records) {
      if (record.seq !== next) {
        throw new StoreError({
          reason: 'out_of_order',
          message: `History ${this.#file} expected record ${String(next)}, got ${String(record.seq)}`,
        });
      }

      next += 1;
    }

    try {
      for (const record of records) await appendJsonLine({ file: this.#file, value: record });
    } catch (caughtError) {
      // Some lines may have reached the file even though the call failed: count again next time.
      this.#next = undefined;
      throw caughtError;
    }

    this.#next = next;
  }

  /** The `seq` the next record must have, after importing a legacy history if there is one. */
  async #prepare(): Promise<number> {
    if (this.#next !== undefined) return this.#next;

    await trimPartialLine({ file: this.#file });
    await this.#importLegacy();

    let count = 0;

    for await (const record of readJsonLines({ file: this.#file, schema: historyRecordSchema })) {
      if (record.seq !== count) {
        throw new StoreError({
          reason: 'failed',
          message: `History ${this.#file} skips from ${String(count)} to ${String(record.seq)}`,
        });
      }

      count += 1;
    }

    this.#next = count;

    return count;
  }

  /** Imports `history.json` into a log that has no file yet; does nothing otherwise. */
  async #importLegacy(): Promise<void> {
    for await (const ignored of readJsonLines({ file: this.#file, schema: historyRecordSchema })) {
      // A log that has a first record is the truth: the legacy file was imported before.
      if (ignored) return;
    }

    const legacy = await readJsonFile({
      file: this.#legacyFile,
      schema: historySchema,
      holdsSecrets: true,
    });

    if (!legacy || legacy.length === 0) return;

    await writeJsonLines({
      file: this.#file,
      values: legacy.map((entry, seq) => ({ seq, entry })),
    });
  }
}
