import { Markdown } from '@earendil-works/pi-tui';
import { markdownTheme } from './markdown-theme.utils.js';

/**
 * One Markdown block as terminal lines, each at most `width` columns and without the padding
 * the library adds to fill the line.
 */
export function renderMarkdown(params: { markdown: string; width: number }): string[] {
  const { markdown, width } = params;
  const lines = new Markdown(markdown, 0, 0, markdownTheme).render(Math.max(1, width));

  return lines.map((line) => line.trimEnd());
}
