import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createPalette } from '../../theme/palette.utils.js';
import { THEMES } from '../../theme/theme.constants.js';
import { CodeFence } from '../code-fence.service.js';

const plain = (lines: string[]): string[] => lines.map((line) => stripVTControlCharacters(line));

describe('CodeFence', () => {
  it('draws borders with the language, and indents the code', () => {
    const fence = new CodeFence({ info: 'ts title="a"', width: 40, plain: false });

    expect(plain(fence.open())).toEqual(['```ts']);
    expect(plain(fence.line('const a = 1;'))).toEqual(['  const a = 1;']);
    expect(plain(fence.line(''))).toEqual(['']);
    expect(plain(fence.close())).toEqual(['```']);
  });

  it('colours the code of a known language, and carries a comment to the next line', () => {
    const fence = new CodeFence({ info: 'ts', width: 40, plain: false });
    const [first] = fence.line('/* a');
    const [second] = fence.line('b */ const');

    expect(first).not.toBe(stripVTControlCharacters(first ?? ''));
    expect(second).toContain('\u001b[3m');
    expect(plain(fence.line('x'))).toEqual(['  x']);
  });

  it('takes the colour of a string and a number from the palette it is given', () => {
    const line = 'const a = "b" + 1;';
    const standard = new CodeFence({ info: 'ts', width: 60, plain: false }).line(line)[0];
    const themed = new CodeFence({
      info: 'ts',
      width: 60,
      plain: false,
      palette: createPalette(THEMES.colorblind),
    }).line(line)[0];

    expect(standard).toContain('\u001b[32m"b"');
    expect(standard).toContain('\u001b[33m1');
    expect(themed).toContain('\u001b[94m"b"');
    expect(themed).toContain('\u001b[35m1');
    expect(themed).not.toContain('\u001b[32m');
    expect(stripVTControlCharacters(themed ?? '')).toBe(stripVTControlCharacters(standard ?? ''));
  });

  it('adds no escape codes when plain', () => {
    const fence = new CodeFence({ info: 'ts', width: 40, plain: true });
    const lines = [...fence.open(), ...fence.line('const a = "b"; // c'), ...fence.close()];

    expect(lines).toEqual(['```ts', '  const a = "b"; // c', '```']);
  });

  it('wraps a long line within the width, keeping its indent on each part', () => {
    const fence = new CodeFence({ info: '', width: 12, plain: false });
    const lines = plain(fence.line('aaaa bbbb cccc dddd eeee'));

    expect(lines.length).toBeGreaterThan(1);

    for (const line of lines) {
      expect(line.startsWith('  ')).toBe(true);
      expect(line.length).toBeLessThanOrEqual(12);
    }
  });

  it('keeps the indentation of the code itself', () => {
    const fence = new CodeFence({ info: '', width: 40, plain: false });

    expect(fence.line('    deep')).toEqual(['      deep']);
  });
});
