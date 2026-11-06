import type { z } from 'zod';
import type { themeNameSchema } from './theme.validator.js';

/** The name a user gives a theme (`SHEAVLY_THEME`). */
export type ThemeName = z.infer<typeof themeNameSchema>;

/**
 * A colour of the terminal's own palette: the user's terminal theme decides what it looks like,
 * and both `styleText` and Ink's `color` take these names. No hex: a fixed colour can't promise
 * to be readable on the background behind it.
 */
export type AnsiColor =
  | 'gray'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'redBright'
  | 'greenBright'
  | 'yellowBright'
  | 'blueBright'
  | 'magentaBright'
  | 'cyanBright';

/**
 * What a colour means, not what it is, grouped as `group.role`. A look asks for a role (an error,
 * a line a diff added) and the theme says which colour that is:
 * - `text`: `secondary` for what the reader can skip (chrome, ids, hints), `accent` for what
 *   marks a place (a step, a link, the chosen option).
 * - `status`: how something went. Never the only sign of it: a glyph (`✓`, `✗`, `⚠`) goes with it.
 * - `diff`: lines a change added and removed, which also carry `+` and `-`.
 * - `code`: the parts of highlighted code that take a colour.
 */
export type ThemeRoles = {
  text: 'secondary' | 'accent';
  status: 'success' | 'error' | 'warning';
  diff: 'added' | 'removed';
  code: 'string' | 'number';
};

/** A theme: the colour of every role. Adding a role fails the typecheck of each theme. */
export type Theme = { [Group in keyof ThemeRoles]: Record<ThemeRoles[Group], AnsiColor> };

/** Every role as a function that returns text in its colour. */
export type Painters = {
  [Group in keyof ThemeRoles]: Record<ThemeRoles[Group], (text: string) => string>;
};

/**
 * What the screen styles with: the colour of each role, for Ink's `color`, and the same roles as
 * painters for text built as a string. Both come from one theme, so they can't disagree.
 */
export type Palette = { colors: Theme; paint: Painters };
