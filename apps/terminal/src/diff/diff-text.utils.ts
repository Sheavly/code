import { stripTerminalSequences, truncateToWidth } from '@earendil-works/pi-tui';
import { defaultPalette } from '../theme/palette.utils.js';
import type { Palette } from '../theme/theme.types.js';
import { DIFF_INDENT, DIFF_MIN_TEXT_WIDTH, DIFF_TAB_WIDTH } from './diff.constants.js';
import type { DiffRow } from './diff.types.js';
import { plainTerminalText } from '../render/terminal-text.utils.js';

/**
 * The rows as lines for a terminal `columns` wide: a gutter with the line number, a sign, then
 * the text cut to fit, so a long line never wraps away from its number. The text is the file's,
 * so terminal escapes in it are dropped rather than sent to the terminal. `''` for no rows.
 */
export function formatDiff(params: {
  rows: readonly DiffRow[];
  columns: number;
  /** The colours of the signs and rows; the default theme's if none. */
  palette?: Palette;
}): string {
  const { rows, columns, palette = defaultPalette } = params;
  const numbers = rows.flatMap((row) => ('no' in row ? [row.no] : []));
  const gutter = String(Math.max(0, ...numbers)).length;
  const room = Math.max(DIFF_MIN_TEXT_WIDTH, columns - DIFF_INDENT.length - gutter - 3);

  return rows.map((row) => `${rowText({ row, gutter, room, palette })}\n`).join('');
}

function rowText(params: { row: DiffRow; gutter: number; room: number; palette: Palette }): string {
  const { row, gutter, room, palette } = params;
  const { secondary } = palette.paint.text;
  const blank = DIFF_INDENT + ' '.repeat(gutter + 1);

  if (row.kind === 'unchanged') return `${blank}${secondary(`⋯ ${row.count} unchanged lines`)}`;
  if (row.kind === 'hidden') return `${blank}${secondary(`… ${row.count} more changed lines`)}`;

  const number = secondary(String(row.no).padStart(gutter));
  const text = truncateToWidth(plain(row.text), room, '…');

  if (row.kind === 'added') {
    return `${DIFF_INDENT}${number} ${palette.paint.diff.added(`+ ${text}`)}`;
  }

  if (row.kind === 'removed') {
    return `${DIFF_INDENT}${number} ${palette.paint.diff.removed(`- ${text}`)}`;
  }

  return `${DIFF_INDENT}${number}   ${text}`;
}

function plain(text: string): string {
  return plainTerminalText(
    stripTerminalSequences(text.replaceAll('\t', ' '.repeat(DIFF_TAB_WIDTH))),
  );
}
