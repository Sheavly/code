import type { Environment } from '@sheavly/core/environment/environment.types';
import { createPalette } from './palette.utils.js';
import { THEMES } from './theme.constants.js';
import type { Palette } from './theme.types.js';
import { parseThemeName } from './theme.validator.js';

/**
 * The palette `SHEAVLY_THEME` names (`default` when it is not set).
 *
 * @throws ThemeError when it names a theme there isn't.
 */
export function paletteFromEnv(env: Environment): Palette {
  return createPalette(THEMES[parseThemeName(env.SHEAVLY_THEME)]);
}
