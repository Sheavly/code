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

  /** Puts back lines kept from an earlier run, ahead of any waiting now. Runs none of them. */
  restore(lines: readonly string[]): void {
    this.#lines = [...lines, ...this.#lines];
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
