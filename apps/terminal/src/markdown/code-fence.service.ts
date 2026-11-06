import { wrapTextWithAnsi } from '@earendil-works/pi-tui';
import { defaultPalette } from '../theme/palette.utils.js';
import type { Palette } from '../theme/theme.types.js';
import { languageFor } from './code-languages.utils.js';
import { highlightLine } from './highlight-code.utils.js';
import {
  createCodePaint,
  createMarkdownTheme,
  plainMarkdownTheme,
} from './markdown-theme.utils.js';
import type { CodeFenceDrawing, CodePaint, HighlightState } from './markdown.types.js';

const INDENT = '  ';

/**
 * One fenced code block drawn a line at a time, so a long block shows as it is written instead
 * of all at once when it ends. It looks like the library's own code block (borders, a two-column
 * indent, long lines wrapped), and a comment or string left open by one line carries to the next.
 */
export class CodeFence implements CodeFenceDrawing {
  readonly #tag: string;
  readonly #width: number;
  readonly #theme;
  readonly #language;
  readonly #plain: boolean;
  readonly #paint: CodePaint;
  #state: HighlightState;

  /**
   * `info` is what follows the opening marker (`ts`, `json title="x"`); its first word is the
   * language. Coloured by `palette`, the default theme's if none.
   */
  constructor(params: { info: string; width: number; plain: boolean; palette?: Palette }) {
    const palette = params.palette ?? defaultPalette;

    this.#tag = params.info.trim().split(/\s+/)[0] ?? '';
    this.#width = Math.max(1, params.width - INDENT.length);
    this.#plain = params.plain;
    this.#theme = params.plain ? plainMarkdownTheme : createMarkdownTheme(palette);
    this.#paint = createCodePaint(palette);
    this.#language = languageFor(this.#tag);
  }

  open(): string[] {
    return [this.#theme.codeBlockBorder(`\`\`\`${this.#tag}`)];
  }

  /** The lines one line of code takes, indented; the line itself is wrapped when it is too long. */
  line(code: string): string[] {
    return wrapTextWithAnsi(this.#highlight(code), this.#width).map((part) =>
      `${INDENT}${part}`.trimEnd(),
    );
  }

  close(): string[] {
    return [this.#theme.codeBlockBorder('```')];
  }

  #highlight(code: string): string {
    if (this.#plain || this.#language === undefined) return code;

    const painted = highlightLine({
      line: code,
      language: this.#language,
      state: this.#state,
      paint: this.#paint,
    });

    this.#state = painted.state;

    return painted.text;
  }
}
