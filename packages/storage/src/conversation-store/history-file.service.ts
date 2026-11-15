import path from 'node:path';
import { z } from 'zod';
import type { HistoryLog } from '@sheavly/core/store/store.types';
import type { HistoryRecord } from '@sheavly/protocol/history/history.types';
import { historyRecordSchema } from '@sheavly/protocol/history/history.validator';
import { readJsonFile } from '../json-file/json-file.helper.js';
import { readJsonLines, writeJsonLines } from '../jsonl-file/jsonl-file.helper.js';
import { removeFile } from '../safe-path/safe-path.helper.js';
import { AppendLog } from './append-log.service.js';
import { historySchema } from './conversation-store.validator.js';

/**
 * One session's history log, `history.jsonl`: a record a line, in `seq` order with no gaps, never
 * rewritten. Like `EntryFile`, the next `seq` is counted from the file once (after a line cut off
 * by a crash is trimmed) and then kept, and appends go one at a time through a queue.
 *
 * A history stored whole in `legacyFile` (`history.json`) before logs existed is imported the
 * first time the log is used and the log has no file yet: written in one atomic step, so a crash
 * leaves either no log (imported again next time) or the complete one. The legacy file is removed
 * once the log is written, so no second copy is left to drift.
 */
export class HistoryFile implements HistoryLog {
  readonly #log: AppendLog<HistoryRecord>;

  constructor(params: { file: string; legacyFile: string }) {
    this.#log = new AppendLog({
      file: params.file,
      schema: historyRecordSchema,
      noun: 'History',
      unit: 'record',
      prepare: async () => importLegacy(params),
    });
  }

  async append(records: readonly HistoryRecord[]): Promise<void> {
    await this.#log.append(records);
  }

  async *read(from = 0): AsyncGenerator<HistoryRecord> {
    // The first read imports a legacy history, so the log it reads is the imported one.
    await this.#log.ready();
    yield* this.#log.read(from);
  }

  /** Forgets the count, once the folder is deleted, so a conversation made again starts at 0. */
  async forget(): Promise<void> {
    await this.#log.forget();
  }
}

/** Imports `legacyFile` into a log that has no record yet; does nothing otherwise. */
async function importLegacy(params: { file: string; legacyFile: string }): Promise<void> {
  for await (const ignored of readJsonLines({ file: params.file, schema: historyRecordSchema })) {
    // A log that has a first record is the truth: the legacy file was imported before.
    if (ignored) return;
  }

  const legacy = await readJsonFile({
    file: params.legacyFile,
    schema: historySchema,
    holdsSecrets: true,
  });

  if (!legacy || legacy.length === 0) return;

  await writeJsonLines({
    file: params.file,
    values: legacy.map((entry, seq) => ({ seq, entry })),
  });
  // Only after the log is whole: a crash before this leaves both, and the log wins next time.
  await removeLegacy(params.legacyFile);
}

/** The two legacy names: the main session's `history`, and a sub-agent's `<uuid>.history`. */
const legacyNameSchema = z.string().regex(/^(history|[0-9a-f-]{36}\.history)$/);

async function removeLegacy(legacyFile: string): Promise<void> {
  await removeFile({
    folder: path.dirname(legacyFile),
    name: path.basename(legacyFile, '.json'),
    extension: '.json',
    shape: legacyNameSchema,
  });
}
