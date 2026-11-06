import { styleText } from 'node:util';
import { THEMES } from './theme.constants.js';
import type { AnsiColor, Palette, Painters, Theme } from './theme.types.js';

// The screen writes to its own terminal through pi-tui or Ink, not to stdout, so whether stdout
// is a terminal says nothing about it: always style. `NO_COLOR` is the view's to apply.
const painter = (color: AnsiColor) => (text: string) =>
  styleText(color, text, { validateStream: false });

function paintersOf(theme: Theme): Painters {
  return {
    text: { secondary: painter(theme.text.secondary), accent: painter(theme.text.accent) },
    status: {
      success: painter(theme.status.success),
      error: painter(theme.status.error),
      warning: painter(theme.status.warning),
    },
    diff: { added: painter(theme.diff.added), removed: painter(theme.diff.removed) },
    code: { string: painter(theme.code.string), number: painter(theme.code.number) },
  };
}

/** The palette of a theme: its colours, and a painter for each role. */
export function createPalette(theme: Theme): Palette {
  return { colors: theme, paint: paintersOf(theme) };
}

/** The palette of the `default` theme, for what is drawn without being told another. */
export const defaultPalette: Palette = createPalette(THEMES.default);
