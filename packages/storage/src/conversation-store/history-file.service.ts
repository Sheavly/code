import type { HistoryLog } from '@sheavly/core/store/store.types';
import type { HistoryRecord } from '@sheavly/protocol/history/history.types';
import { historyRecordSchema } from '@sheavly/protocol/history/history.validator';
import { AppendLog } from './append-log.service.js';

/**
 * One session's history log, `history.jsonl`: a record a line, in `seq` order with no gaps, never
 * rewritten. Like `EntryFile`, the next `seq` is counted from the file once (after a line cut off
 * by a crash is trimmed) and then kept, and appends go one at a time through a queue.
 */
export class HistoryFile implements HistoryLog {
  readonly #log: AppendLog<HistoryRecord>;

  constructor(params: { file: string }) {
    this.#log = new AppendLog({
      file: params.file,
      schema: historyRecordSchema,
      noun: 'History',
      unit: 'record',
    });
  }

  async append(records: readonly HistoryRecord[]): Promise<void> {
    await this.#log.append(records);
  }

  async *read(from = 0): AsyncGenerator<HistoryRecord> {
    await this.#log.ready();
    yield* this.#log.read(from);
  }

  /** Forgets the count, once the folder is deleted, so a conversation made again starts at 0. */
  async forget(): Promise<void> {
    await this.#log.forget();
  }
}
