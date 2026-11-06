import { styleText, stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createPalette, defaultPalette } from '../palette.utils.js';
import { THEMES } from '../theme.constants.js';
import type { AnsiColor, Theme } from '../theme.types.js';

/** Every colour a theme uses, with the role it is for, as `group.role`. */
function rolesOf(theme: Theme): [string, AnsiColor][] {
  return Object.entries(theme).flatMap(([group, roles]) =>
    Object.entries(roles).map(([role, color]): [string, AnsiColor] => [`${group}.${role}`, color]),
  );
}

describe('createPalette', () => {
  it('paints text in the colour a role has, and keeps the text', () => {
    const palette = createPalette(THEMES.default);

    expect(palette.paint.status.error('boom')).toBe('\u001b[31mboom\u001b[39m');
    expect(palette.paint.status.success('ok')).toBe('\u001b[32mok\u001b[39m');
    expect(palette.paint.text.secondary('dim')).toBe('\u001b[90mdim\u001b[39m');
    expect(stripVTControlCharacters(palette.paint.diff.added('+ a'))).toBe('+ a');
  });

  it('styles whatever stdout is: the screen draws to its own terminal', () => {
    expect(defaultPalette.paint.text.accent('x')).not.toBe('x');
  });

  it('gives the colours it paints with, for what draws through Ink', () => {
    const palette = createPalette(THEMES.colorblind);

    expect(palette.colors.status.success).toBe('blueBright');
    expect(palette.paint.status.success('ok')).toBe('\u001b[94mok\u001b[39m');
  });

  it('paints every role of every theme in the colour that theme gives it', () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      const { paint } = createPalette(theme);
      const roles: [string, (text: string) => string, AnsiColor][] = [
        ['text.secondary', paint.text.secondary, theme.text.secondary],
        ['text.accent', paint.text.accent, theme.text.accent],
        ['status.success', paint.status.success, theme.status.success],
        ['status.error', paint.status.error, theme.status.error],
        ['status.warning', paint.status.warning, theme.status.warning],
        ['diff.added', paint.diff.added, theme.diff.added],
        ['diff.removed', paint.diff.removed, theme.diff.removed],
        ['code.string', paint.code.string, theme.code.string],
        ['code.number', paint.code.number, theme.code.number],
      ];

      for (const [role, painter, color] of roles) {
        expect(painter('x'), `${name} ${role}`).toBe(
          styleText(color, 'x', { validateStream: false }),
        );
      }
    }
  });
});

describe('THEMES', () => {
  it('tells the two sides of every pair apart, in every theme', () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      expect(theme.status.success, name).not.toBe(theme.status.error);
      expect(theme.diff.added, name).not.toBe(theme.diff.removed);
      expect(theme.status.warning, name).not.toBe(theme.status.error);
      expect(theme.text.secondary, name).not.toBe(theme.text.accent);
    }
  });

  it('keeps the colours the chat always had in the default theme', () => {
    expect(rolesOf(THEMES.default).map(([role, color]) => `${role}=${color}`)).toEqual([
      'text.secondary=gray',
      'text.accent=cyan',
      'status.success=green',
      'status.error=red',
      'status.warning=yellow',
      'diff.added=green',
      'diff.removed=red',
      'code.string=green',
      'code.number=yellow',
    ]);
  });

  it('leaves red and green out of the colourblind theme altogether', () => {
    const reddish = /^(red|green)/;

    for (const [role, color] of rolesOf(THEMES.colorblind)) {
      expect(color, role).not.toMatch(reddish);
    }
  });

  it('uses only colours the terminal itself defines, never a fixed hex', () => {
    for (const theme of Object.values(THEMES)) {
      for (const [role, color] of rolesOf(theme)) {
        expect(color, role).toMatch(/^[a-z]+$/i);
      }
    }
  });
});
