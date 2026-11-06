const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * Turns a reply written in pieces into rendered Markdown, one block at a time. A block (a
 * paragraph, a list, a table, a fenced code block) is rendered once it is complete, because a
 * later line can change how the lines above it look: a table's column widths, a list's items.
 * Until then its raw text is `pending`, for a screen to show in its live area. What `push` and
 * `flush` return is finished lines, each ended with a newline except the last line of a
 * `flush`, which keeps its newline only if the text had one.
 *
 * A block ends at a blank line, or at the closing line of a code fence; an opening fence ends the
 * paragraph before it. Blank lines between blocks are kept, so spacing reads as it was written.
 */
export class MarkdownStream {
  readonly #render: (markdown: string) => string[];
  #block: string[] = [];
  /** The marker that opened the code fence being read, `undefined` outside one. */
  #fence: string | undefined;
  #partial = '';

  /** `render` turns one complete block of Markdown into lines, at the screen's width. */
  constructor(render: (markdown: string) => string[]) {
    this.#render = render;
  }

  /** The raw text of the block being written, which isn't rendered until the block ends. */
  get pending(): string {
    const lines = this.#partial === '' ? this.#block : [...this.#block, this.#partial];

    return lines.join('\n');
  }

  /** Adds `text`; returns the lines of the blocks it completed, ready to print. */
  push(text: string): string {
    const pieces = (this.#partial + text).replaceAll('\r\n', '\n').split('\n');

    this.#partial = pieces.pop() ?? '';

    return pieces.map((line) => this.#accept(line)).join('');
  }

  /** Ends the block being written, complete or not, and returns it rendered. */
  flush(): string {
    const endedLine = this.#partial === '' && this.#block.length > 0;
    const lines = this.#partial === '' ? this.#block : [...this.#block, this.#partial];

    this.#block = [];
    this.#fence = undefined;
    this.#partial = '';

    if (lines.length === 0) return '';

    const rendered = this.#render(lines.join('\n')).join('\n');

    return endedLine ? `${rendered}\n` : rendered;
  }

  #accept(line: string): string {
    if (this.#fence !== undefined) return this.#acceptInFence({ line, fence: this.#fence });

    if (line.trim() === '') return this.#endBlock() + '\n';

    const opening = OPENING_FENCE.exec(line)?.[1];

    if (opening === undefined) {
      this.#block.push(line);

      return '';
    }

    const interrupted = this.#endBlock();

    this.#fence = opening;
    this.#block.push(line);

    return interrupted;
  }

  /** Inside a fence every line, blank ones too, belongs to the code until the fence closes. */
  #acceptInFence(params: { line: string; fence: string }): string {
    const { line, fence } = params;
    const closing = CLOSING_FENCE.exec(line)?.[1];

    this.#block.push(line);

    const closes =
      closing !== undefined && closing.at(0) === fence.at(0) && closing.length >= fence.length;

    if (!closes) return '';
    this.#fence = undefined;

    return this.#endBlock();
  }

  #endBlock(): string {
    if (this.#block.length === 0) return '';

    const lines = this.#render(this.#block.join('\n'));

    this.#block = [];

    return lines.map((line) => `${line}\n`).join('');
  }
}
