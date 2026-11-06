import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createPalette } from '../../theme/palette.utils.js';
import { THEMES } from '../../theme/theme.constants.js';
import { formatDiff } from '../diff-text.utils.js';
import type { DiffRow } from '../diff.types.js';

const plainText = (rows: DiffRow[], columns = 40) =>
  stripVTControlCharacters(formatDiff({ rows, columns }));

describe('formatDiff', () => {
  it('lays out a gutter, a sign and the text, with the numbers right-aligned', () => {
    expect(
      plainText([
        { kind: 'context', no: 9, text: 'before' },
        { kind: 'removed', no: 10, text: 'old' },
        { kind: 'added', no: 10, text: 'new' },
      ]),
    ).toBe('     9   before\n    10 - old\n    10 + new\n');
  });

  it('says what it folded and what it left out, under the sign column', () => {
    expect(
      plainText([
        { kind: 'added', no: 1, text: 'a' },
        { kind: 'unchanged', count: 22 },
        { kind: 'hidden', count: 8 },
      ]),
    ).toBe('    1 + a\n      ⋯ 22 unchanged lines\n      … 8 more changed lines\n');
  });

  it('colours additions green and removals red', () => {
    const out = formatDiff({
      rows: [
        { kind: 'removed', no: 1, text: 'old' },
        { kind: 'added', no: 1, text: 'new' },
      ],
      columns: 40,
    });

    expect(out).toContain('\u001b[31m- old');
    expect(out).toContain('\u001b[32m+ new');
  });

  it('takes the colours of additions and removals from the palette it is given', () => {
    const out = formatDiff({
      rows: [
        { kind: 'removed', no: 1, text: 'old' },
        { kind: 'added', no: 1, text: 'new' },
      ],
      columns: 40,
      palette: createPalette(THEMES.colorblind),
    });

    expect(out).toContain('\u001b[33m- old');
    expect(out).toContain('\u001b[94m+ new');
    expect(out).not.toContain('\u001b[31m');
    expect(out).not.toContain('\u001b[32m');
  });

  it('cuts a long line to the width, so it never wraps away from its number', () => {
    const [line] = plainText([{ kind: 'added', no: 1, text: 'x'.repeat(200) }], 30).split('\n');

    expect(line).toHaveLength(30);
    expect(line?.endsWith('…')).toBe(true);
  });

  it('expands tabs, drops terminal sequences and shows carriage returns visibly', () => {
    const text = plainText([{ kind: 'added', no: 1, text: '\tgo\u001b]0;pwned\u0007\u001b[2J\r' }]);

    expect(text).toBe('    1 +     go\\r\n');
    expect(text).not.toContain('pwned');
  });

  it('is empty for no rows', () => {
    expect(formatDiff({ rows: [], columns: 40 })).toBe('');
  });
});
