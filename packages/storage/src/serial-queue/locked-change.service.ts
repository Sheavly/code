import { withFileLock } from '../file-lock/file-lock.helper.js';
import { SerialQueue } from './serial-queue.service.js';

/**
 * The one way a store reads a file and writes it back whole: one change at a time in this
 * process (a queue), and one at a time across processes (a lock beside `name`). Every store with a
 * read-modify-write uses it, so none has its own copy of the rule.
 */
export class LockedChange {
  readonly #name: string;
  readonly #queue = new SerialQueue();

  /** `name` is a path the lock file is named after: the file, or the folder of files, it guards. */
  constructor(params: { name: string }) {
    this.#name = params.name;
  }

  /** Runs `change` after the changes before it, here and in other processes. */
  run<T>(change: () => Promise<T>): Promise<T> {
    return this.#queue.run(async () => withFileLock({ name: this.#name, task: change }));
  }
}
