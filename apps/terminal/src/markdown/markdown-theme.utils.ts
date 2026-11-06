import type { MarkdownTheme } from '@earendil-works/pi-tui';
import { bold, italic, strikethrough, underline } from '../render/style.utils.js';
import type { Palette } from '../theme/theme.types.js';
import { highlightCode } from './highlight-code.utils.js';
import type { CodePaint } from './markdown.types.js';

const plain = (text: string): string => text;

/**
 * How code is coloured by `palette`. No part of it is told apart by colour alone: a keyword is
 * bold, a comment is italic, and a string or a number is recognised by its quotes or digits.
 */
export function createCodePaint(palette: Palette): CodePaint {
  const { text, code } = palette.paint;

  return {
    keyword: (word) => text.accent(bold(word)),
    string: code.string,
    number: code.number,
    comment: (line) => text.secondary(italic(line)),
  };
}

/**
 * How a reply's Markdown looks in `palette`'s colours: restrained, like the rest of the chat.
 * Structure (list markers, quote bars, code borders) is secondary, emphasis is the terminal's
 * own, and only links and inline code take a colour.
 */
export function createMarkdownTheme(palette: Palette): MarkdownTheme {
  const { secondary, accent } = palette.paint.text;
  const paint = createCodePaint(palette);

  return {
    heading: bold,
    link: (text) => accent(underline(text)),
    linkUrl: secondary,
    code: accent,
    codeBlock: plain,
    codeBlockBorder: secondary,
    quote: secondary,
    quoteBorder: secondary,
    hr: secondary,
    listBullet: secondary,
    bold,
    italic,
    strikethrough,
    underline,
    highlightCode: (code, lang) => highlightCode({ code, lang, paint }),
  };
}

/**
 * For a screen that strips styling (`NO_COLOR`): no escape codes at all, and the two spans whose
 * meaning styling carried are written out, inline code in backticks and a strike-through in
 * `~~`. Bold and italic are only emphasis, and stay unmarked: a heading is drawn with the bold
 * style, which the library replays after every inline span, so a marker there would be repeated.
 * For the same reason the first two heading levels show only as a line before a blank one;
 * from the third on the library writes the `#`s itself.
 */
export const plainMarkdownTheme: MarkdownTheme = {
  heading: plain,
  link: plain,
  linkUrl: plain,
  code: (text) => `\`${text}\``,
  codeBlock: plain,
  codeBlockBorder: plain,
  quote: plain,
  quoteBorder: plain,
  hr: plain,
  listBullet: plain,
  bold: plain,
  italic: plain,
  strikethrough: (text) => `~~${text}~~`,
  underline: plain,
};
