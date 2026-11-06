import { describe, expect, it } from 'vitest';
import { ThemeError } from '../../errors/theme.errors.js';
import { defaultPalette } from '../palette.utils.js';
import { THEMES } from '../theme.constants.js';
import { paletteFromEnv } from '../theme.helper.js';
import { parseThemeName } from '../theme.validator.js';

describe('parseThemeName', () => {
  it('is the default theme when none is asked for, or the value is empty', () => {
    expect(parseThemeName(undefined)).toBe('default');
    expect(parseThemeName('')).toBe('default');
  });

  it('accepts the names of the themes there are', () => {
    expect(parseThemeName('default')).toBe('default');
    expect(parseThemeName('colorblind')).toBe('colorblind');
  });

  it('refuses any other name and lists the ones there are, instead of using a default', () => {
    expect(() => parseThemeName('solarized')).toThrow(ThemeError);
    expect(() => parseThemeName('solarized')).toThrow(
      'Unknown theme "solarized": use default or colorblind.',
    );
    // A name is exact: a different case is another name, not a typo to guess at.
    expect(() => parseThemeName('Colorblind')).toThrow(ThemeError);
  });

  it('keeps the validation error as the cause', () => {
    let refused: unknown;

    try {
      parseThemeName('nope');
    } catch (caughtError) {
      refused = caughtError;
    }

    expect(refused).toBeInstanceOf(ThemeError);
    expect(refused).toHaveProperty('cause');
  });
});

describe('paletteFromEnv', () => {
  it('reads SHEAVLY_THEME, and uses the default theme when it is not set', () => {
    expect(paletteFromEnv({}).colors).toEqual(THEMES.default);
    expect(paletteFromEnv({ SHEAVLY_THEME: 'colorblind' }).colors).toEqual(THEMES.colorblind);
    expect(paletteFromEnv({}).colors).toEqual(defaultPalette.colors);
  });

  it('fails on a theme that does not exist, before anything is drawn', () => {
    expect(() => paletteFromEnv({ SHEAVLY_THEME: 'neon' })).toThrow(ThemeError);
  });
});
