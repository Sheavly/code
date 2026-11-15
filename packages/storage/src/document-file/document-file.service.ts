import { assertSafeRoot } from '../safe-path/safe-path.helper.js';
import { readJsonFile, writeJsonFile } from '../json-file/json-file.helper.js';
import { LockedChange } from '../serial-queue/locked-change.service.js';
import { documentSchema } from './document-file.validator.js';

/**
 * One JSON document in one file, for an owner that knows what is in it and keeps its own schema
 * (workspace trust is one). Storage adds what every file here gets: a missing file is "nothing
 * stored", anything else wrong with it names the file, a write replaces the file whole and private
 * to the user, and changes go one at a time.
 *
 * A change reads the document and writes it back whole, so two at once would both start from the
 * same contents and the second would erase the first's. `update` queues them, in this process and
 * (through a lock file beside the document) across processes.
 */
export class DocumentFile {
  /** Where the document is kept, absolute, for an owner that must know (and for its errors). */
  readonly file: string;
  readonly #changes: LockedChange;

  constructor(params: { file: string }) {
    this.file = assertSafeRoot(params.file);
    this.#changes = new LockedChange({ name: this.file });
  }

  /**
   * The stored document, or `undefined` when nothing is stored yet. Throws a `StorageFileError`
   * naming the file when it can't be read or is not JSON: a file that exists is never taken for
   * empty, since the next write would replace it.
   */
  async load(): Promise<unknown> {
    // A document may hold private text (a queued prompt), so a parse error never quotes it.
    return readJsonFile({ file: this.file, schema: documentSchema, holdsSecrets: true });
  }

  /**
   * Replaces the document with what `change` makes of the current one (`undefined` when nothing is
   * stored). Returning `undefined` stores nothing: there is no document yet, or no change to
   * make. A `change` that throws stores nothing and its error is thrown here. Each change sees the
   * result of the one before it.
   */
  async update(change: (current: unknown) => unknown): Promise<void> {
    await this.#changes.run(async () => {
      const next = change(await this.load());

      if (next === undefined) return;

      await writeJsonFile({ file: this.file, value: next });
    });
  }
}
