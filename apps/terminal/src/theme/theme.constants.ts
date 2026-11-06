import type { Theme, ThemeName } from './theme.types.js';

/**
 * Every theme, as data: the colour of each role. `default` is the colours the chat always had.
 *
 * `colorblind` takes red and green out of every pair that has to be told apart (success and
 * error, added and removed): blue and yellow stay apart in red-green colour blindness. Warning
 * moves to magenta so it doesn't share yellow with an error. A sign always goes with the colour
 * (`✓`/`✗`, `+`/`-`), so no theme is the only thing saying what happened.
 */
export const THEMES: Record<ThemeName, Theme> = {
  default: {
    text: { secondary: 'gray', accent: 'cyan' },
    status: { success: 'green', error: 'red', warning: 'yellow' },
    diff: { added: 'green', removed: 'red' },
    code: { string: 'green', number: 'yellow' },
  },
  colorblind: {
    text: { secondary: 'gray', accent: 'cyan' },
    status: { success: 'blueBright', error: 'yellow', warning: 'magenta' },
    diff: { added: 'blueBright', removed: 'yellow' },
    code: { string: 'blueBright', number: 'magenta' },
  },
};
