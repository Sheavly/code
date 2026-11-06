import type { CodeFenceDrawing } from './markdown.types.js';

const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/** A code fence being read: what closes it, how far its lines were indented, how it is drawn. */
type OpenFence = { marker: string; indent: number; drawing: CodeFenceDrawing };

/**
 * Turns a reply written in pieces into rendered Markdown, one block at a time. A block (a
 * paragraph, a list, a table) is rendered once it is complete, because a later line can change
 * how the lines above it look: a table's column widths, a list's items. Until then its raw text
 * is `pending`, for a screen to show in its live area. What `push` and `flush` return is finished
 * lines, each ended with a newline except the last line of a `flush`, which keeps its newline
 * only if the text had one.
 *
 * A block ends at a blank line; an opening fence ends the paragraph before it. Blank lines
 * between blocks are kept, so spacing reads as it was written. A fenced code block is the
 * exception: it never waits, since no later line changes how an earlier line of code looks, so
 * a block of hundreds of lines appears as it arrives, line by line.
 */
export class MarkdownStream {
  readonly #render: (markdown: string) => string[];
  readonly #drawFence: (info: string) => CodeFenceDrawing;
  #block: string[] = [];
  #fence: OpenFence | undefined;
  #partial = '';

  /**
   * `render` turns one complete block of Markdown into lines, at the screen's width.
   * `drawFence` starts the drawing of a code block, given the text after its opening marker.
   */
  constructor(params: {
    render: (markdown: string) => string[];
    drawFence: (info: string) => CodeFenceDrawing;
  }) {
    this.#render = params.render;
    this.#drawFence = params.drawFence;
  }

  /** The raw text of what is being written and isn't drawn yet: a block, or a line of code. */
  get pending(): string {
    if (this.#fence !== undefined) return this.#partial;

    const lines = this.#partial === '' ? this.#block : [...this.#block, this.#partial];

    return lines.join('\n');
  }

  /** Adds `text`; returns the lines of the blocks it completed, ready to print. */
  push(text: string): string {
    const pieces = (this.#partial + text).replaceAll('\r\n', '\n').split('\n');

    this.#partial = pieces.pop() ?? '';

    return pieces.map((line) => this.#accept(line)).join('');
  }

  /**
   * Ends what is being written, complete or not, and returns it drawn; a code block still open
   * is closed.
   */
  flush(): string {
    const endedLine = this.#partial === '' && (this.#block.length > 0 || this.#fence !== undefined);
    const rendered = this.#fence === undefined ? this.#flushBlock() : this.#flushFence(this.#fence);

    this.#block = [];
    this.#fence = undefined;
    this.#partial = '';

    if (rendered.length === 0) return '';

    return endedLine ? `${rendered.join('\n')}\n` : rendered.join('\n');
  }

  #flushBlock(): string[] {
    const lines = this.#partial === '' ? this.#block : [...this.#block, this.#partial];

    return lines.length === 0 ? [] : this.#render(lines.join('\n'));
  }

  #flushFence(fence: OpenFence): string[] {
    const unfinished =
      this.#partial === '' ? [] : fence.drawing.line(dedent({ line: this.#partial, fence }));

    return [...unfinished, ...fence.drawing.close()];
  }

  #accept(line: string): string {
    if (this.#fence !== undefined) return this.#acceptInFence({ line, fence: this.#fence });

    if (line.trim() === '') return this.#endBlock() + '\n';

    const opening = openingFence(line);

    if (opening === undefined) {
      this.#block.push(line);

      return '';
    }

    const interrupted = this.#endBlock();
    const drawing = this.#drawFence(opening.info);

    this.#fence = { marker: opening.marker, indent: opening.indent, drawing };

    return interrupted + asText(drawing.open());
  }

  /** Inside a fence every line, blank ones too, belongs to the code until the fence closes. */
  #acceptInFence(params: { line: string; fence: OpenFence }): string {
    const { line, fence } = params;

    if (!closesFence({ line, marker: fence.marker })) {
      return asText(fence.drawing.line(dedent({ line, fence })));
    }

    this.#fence = undefined;

    return asText(fence.drawing.close());
  }

  #endBlock(): string {
    if (this.#block.length === 0) return '';

    const lines = this.#render(this.#block.join('\n'));

    this.#block = [];

    return asText(lines);
  }
}

const asText = (lines: string[]): string => lines.map((line) => `${line}\n`).join('');

/**
 * Reads a line that opens a fence. A backtick fence can't have a backtick in its info text,
 * which is what tells it from a line of inline code that starts with three of them.
 */
function openingFence(line: string): { marker: string; indent: number; info: string } | undefined {
  const match = OPENING_FENCE.exec(line);

  if (match === null) return undefined;

  const [, indent = '', marker = '', info = ''] = match;

  if (marker.startsWith('`') && info.includes('`')) return undefined;

  return { marker, indent: indent.length, info };
}

/** A closing fence uses the opening one's character, at least as many times, and nothing else. */
function closesFence(params: { line: string; marker: string }): boolean {
  const { line, marker } = params;
  const closing = CLOSING_FENCE.exec(line)?.[1];

  return (
    closing !== undefined && closing.startsWith(marker[0] ?? '') && closing.length >= marker.length
  );
}

/** The code of a line, without the indent its fence had (as much of it as the line has). */
function dedent(params: { line: string; fence: OpenFence }): string {
  const { line, fence } = params;
  const spaces = /^ */.exec(line)?.[0].length ?? 0;

  return line.slice(Math.min(spaces, fence.indent));
}
