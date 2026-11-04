/** The failure of a task is its caller's, via the promise `run` returned; here it only ended. */
const ended = (): void => undefined;

/**
 * Runs tasks one after the other. For work that reads a file and writes it back whole: two such
 * tasks at once would both start from the same contents, and the second would erase the first's
 * change. One queue serializes the tasks of one owner (a store), in the order they were given.
 */
export class SerialQueue {
  #tail: Promise<void> = Promise.resolve();

  /**
   * Runs `task` once every task given before it has ended, however it ended: one that failed
   * does not hold up the next. Resolves with the task's result, or rejects with its error.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task);

    this.#tail = result.then(ended, ended);

    return result;
  }
}
