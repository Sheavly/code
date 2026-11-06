import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { ThemeError } from '../errors/theme.errors.js';
import type { ThemeName } from './theme.types.js';

/** The themes there are: `default`, and `colorblind` for red-green colour blindness. */
export const themeNameSchema = z.enum(['default', 'colorblind']);

/**
 * The theme a user asked for, or `default` when they asked for none. A name that is not a theme
 * is an error that lists the ones there are, not a silent fall back to something they didn't ask
 * for.
 */
export function parseThemeName(value: string | undefined): ThemeName {
  if (value === undefined || value === '') return 'default';

  return parseOrThrow({
    schema: themeNameSchema,
    input: value,
    onInvalid: ({ error }) =>
      new ThemeError({
        message: `Unknown theme "${value}": use ${themeNameSchema.options.join(' or ')}.`,
        cause: error,
      }),
  });
}
