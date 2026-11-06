import {
  OUTPUT_HEAD_LINES,
  OUTPUT_TAIL_LINES,
  OUTPUT_LINE_CHARS,
  SHORTENED_LINE,
} from './output.constants.js';

/** A bounded first/last preview. The caller can still stream the original chunks to pipes or observers. */
export class OutputBuffer {
  readonly #maxChars: number;
  readonly #headBudget: number;
  readonly #tailBudget: number;
  readonly #head: string[] = [];
  readonly #tail: string[] = [];
  #headChars = 0;
  #tailChars = 0;
  #headFull = false;
  #lines = 0;
  #lineHead = '';
  #lineTail = '';
  #lineLength = 0;

  /** `maxChars` is a caller-owned limit; 30,000 leaves room for the default line budgets. */
  constructor(params: { maxChars: number }) {
    this.#maxChars = Math.max(0, params.maxChars);
    // Reserve a pending line and the omission marker in addition to stored complete lines.
    const budget = Math.max(0, this.#maxChars - OUTPUT_LINE_CHARS - 96);

    this.#headBudget = Math.floor(budget / 2);
    this.#tailBudget = budget - this.#headBudget;
  }

  push(chunk: string): void {
    let start = 0;

    for (let end = chunk.indexOf('\n'); end !== -1; end = chunk.indexOf('\n', start)) {
      this.#appendFragment(chunk.slice(start, end));
      this.#keepLine();
      start = end + 1;
    }

    this.#appendFragment(chunk.slice(start));
  }

  get text(): string {
    const tail = this.#lineLength > 0 ? this.#tail.slice(-(OUTPUT_TAIL_LINES - 1)) : this.#tail;
    const omitted = this.#lines - this.#head.length - tail.length;
    const marker = omitted > 0 ? `… [${String(omitted)} lines omitted] …\n` : '';

    return (this.#head.join('') + marker + tail.join('') + this.#currentLine()).slice(
      0,
      this.#maxChars,
    );
  }

  #appendFragment(fragment: string): void {
    const half = OUTPUT_LINE_CHARS / 2;
    const used = Math.min(fragment.length, half - this.#lineHead.length);

    // Copy bounded slices so they do not retain a large incoming string's backing storage.
    this.#lineHead += Array.from(fragment.slice(0, used)).join('');
    const rest = fragment.slice(used);

    if (rest.length >= half) this.#lineTail = Array.from(rest.slice(-half)).join('');
    else this.#lineTail = (this.#lineTail + rest).slice(-half);
    this.#lineLength += fragment.length;
  }

  #currentLine(): string {
    if (this.#lineLength <= OUTPUT_LINE_CHARS) return this.#lineHead + this.#lineTail;

    const tailChars = OUTPUT_LINE_CHARS - this.#lineHead.length - SHORTENED_LINE.length;

    return this.#lineHead + SHORTENED_LINE + this.#lineTail.slice(-tailChars);
  }

  #keepLine(): void {
    const line = `${this.#currentLine()}\n`;

    this.#lines += 1;
    this.#lineHead = '';
    this.#lineTail = '';
    this.#lineLength = 0;

    if (
      !this.#headFull &&
      this.#head.length < OUTPUT_HEAD_LINES &&
      this.#headChars + line.length <= this.#headBudget
    ) {
      this.#head.push(line);
      this.#headChars += line.length;

      return;
    }

    this.#headFull = true;
    this.#tail.push(line);
    this.#tailChars += line.length;

    while (this.#tail.length > OUTPUT_TAIL_LINES || this.#tailChars > this.#tailBudget) {
      this.#tailChars -= this.#tail.shift()?.length ?? 0;
    }
  }
}
