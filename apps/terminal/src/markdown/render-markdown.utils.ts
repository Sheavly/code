import { getCapabilities, Markdown, setCapabilities } from '@earendil-works/pi-tui';
import { defaultPalette } from '../theme/palette.utils.js';
import type { Palette } from '../theme/theme.types.js';
import { createMarkdownTheme, plainMarkdownTheme } from './markdown-theme.utils.js';

/**
 * One Markdown block as terminal lines, each at most `width` columns and without the padding
 * the library adds to fill the line. With `plain`, no styling is added (`plainMarkdownTheme`) and
 * a link shows its address after its text, since a hyperlink escape would be stripped; otherwise
 * it is coloured by `palette`, the default theme's if none, and a link is a hyperlink where the
 * terminal opens them.
 */
export function renderMarkdown(params: {
  markdown: string;
  width: number;
  plain?: boolean;
  palette?: Palette;
}): string[] {
  const { markdown, width, plain = false, palette = defaultPalette } = params;
  const theme = plain ? plainMarkdownTheme : createMarkdownTheme(palette);
  const render = () => new Markdown(markdown, 0, 0, theme).render(Math.max(1, width));
  const lines = plain ? withoutHyperlinks(render) : render();

  return lines.map((line) => line.trimEnd());
}

/**
 * Runs `render` as if the terminal opened no links, which is how the library decides to print an
 * address. It sets a setting the library keeps for the whole process, so `render` must not wait.
 */
function withoutHyperlinks<T>(render: () => T): T {
  const detected = getCapabilities();

  setCapabilities({ ...detected, hyperlinks: false });

  try {
    return render();
  } finally {
    setCapabilities(detected);
  }
}
