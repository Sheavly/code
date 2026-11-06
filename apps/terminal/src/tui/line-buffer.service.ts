/**
 * Turns text written in pieces (a model streaming a few characters at a time) into finished
 * lines and the unfinished line after them. A screen prints a finished line once, into the
 * terminal's own scrollback, and redraws only the unfinished one: the rule that keeps a long
 * conversation from being redrawn on every token.
 */
export class LineBuffer {
  #tail = '';

  /** The line being written, not yet ended with a newline. */
  get tail(): string {
    return this.#tail;
  }

  /** Adds `text`; returns the lines it finished, without their newlines, in order. */
  push(text: string): string[] {
    const pieces = (this.#tail + text).replaceAll('\r\n', '\n').split('\n');

    this.#tail = pieces.pop() ?? '';

    return pieces;
  }

  /** Ends the unfinished line, if there is one, and returns it. */
  flush(): string | undefined {
    const line = this.#tail;

    this.#tail = '';

    return line === '' ? undefined : line;
  }
}
