import type { MarkdownTheme } from '@earendil-works/pi-tui';
import { bold, cyan, gray, italic, strikethrough, underline } from '../render/style.utils.js';

const plain = (text: string): string => text;

/**
 * How a reply's Markdown looks: restrained, like the rest of the chat. Structure (list markers,
 * quote bars, code borders) is dim, emphasis is the terminal's own, and only links and inline
 * code take a colour.
 */
export const markdownTheme: MarkdownTheme = {
  heading: bold,
  link: (text) => cyan(underline(text)),
  linkUrl: gray,
  code: cyan,
  codeBlock: plain,
  codeBlockBorder: gray,
  quote: gray,
  quoteBorder: gray,
  hr: gray,
  listBullet: gray,
  bold,
  italic,
  strikethrough,
  underline,
};
