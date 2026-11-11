import type { FileChange } from '@sheavly/coding/files/files.types';
import { countChanges } from '../diff/diff.utils.js';
import type { FileEdit } from './changes.types.js';

/**
 * Every file change a chat made, in order and numbered from 1, so the screen can show them
 * collapsed as they happen and in full when asked. It keeps what the terminal has seen: the
 * changes of a conversation reopened with `--resume` start from the ones made after it opened.
 * The files' text is kept as it was sent, so the log grows with the files a chat edits.
 */
export class ChangeLog {
  readonly #edits: FileEdit[] = [];

  /** The changes kept so far, oldest first. */
  get edits(): readonly FileEdit[] {
    return this.#edits;
  }

  /**
   * Keeps `change` as the next numbered edit, and returns it. A change to an existing file that
   * changed no line is not kept (`undefined`); a file created or deleted always is, even an empty
   * one.
   */
  keep(change: FileChange): FileEdit | undefined {
    const { path, before, after } = change;
    const counts = countChanges({ before, after });
    const kept = before === null || after === null || counts.added > 0 || counts.removed > 0;

    if (!kept) return undefined;

    const edit = { number: this.#edits.length + 1, path, before, after, ...counts };

    this.#edits.push(edit);

    return edit;
  }
}
