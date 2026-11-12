/**
 * The lines waiting their turn, oldest first. A line leaves only to run as its own prompt or
 * command, so pending input never reaches a live run, its history or its summaries.
 */
export class ChatQueue {
  #lines: string[] = [];

  constructor(private readonly onQueue: (queue: readonly string[]) => void) {}

  get queued(): readonly string[] {
    return [...this.#lines];
  }

  push(text: string): void {
    this.#lines.push(text);
    this.#changed();
  }

  /** The oldest line, removed; undefined when none waits. */
  take(): string | undefined {
    const line = this.#lines.shift();

    this.#changed();

    return line;
  }

  drop(): void {
    this.#lines = [];
    this.#changed();
  }

  #changed(): void {
    this.onQueue(this.queued);
  }
}
