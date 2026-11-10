import { DIFF_EXPANDED_ROWS } from '../diff/diff.constants.js';
import { NO_CHANGES_TEXT } from './changes.constants.js';
import { formatDiff } from '../diff/diff-text.utils.js';
import { buildDiff, countChanges } from '../diff/diff.utils.js';
import { bold } from '../render/style.utils.js';
import { defaultPalette } from '../theme/palette.utils.js';
import type { Palette } from '../theme/theme.types.js';
import type { FileEdit, FileTotal, LinkFile } from './changes.types.js';
import { plainTerminalText } from '../render/terminal-text.utils.js';

const identity: LinkFile = plainTerminalText;

/** The line under a step's result that stands for its diff, which `/changes <number>` expands. */
export function collapsedChange(params: { edit: FileEdit; palette?: Palette }): string {
  const { edit, palette = defaultPalette } = params;
  const { secondary } = palette.paint.text;
  const created = edit.before === null ? secondary(' · new file') : '';

  return `    ${secondary('▸')} ${counts({ ...edit, palette })}${created} ${secondary(`· /changes ${edit.number}`)}\n`;
}

/**
 * What `/changes <target>` shows, for a terminal `columns` wide. Nothing typed lists the files
 * changed; `all` shows every file's total change; a change number selects one edit's diff; and a
 * path (or its end: `a.ts`, `src/a.ts`) the total change of that file. A target that matches
 * nothing says so, and says what to type instead.
 */
export function changesText(params: {
  edits: readonly FileEdit[];
  target: string | undefined;
  columns: number;
  /** The colours it is drawn in; the default theme's if none. */
  palette?: Palette;
  /** How a path is shown, as a link if the terminal opens them; the path as it is if none. */
  linkFile?: LinkFile;
}): string {
  const { edits, target, columns, palette = defaultPalette, linkFile = identity } = params;

  if (edits.length === 0) return NO_CHANGES_TEXT;

  const files = totalsByFile(edits);

  if (target === undefined) return fileList({ files, palette, linkFile });

  if (target === 'all') {
    return files.map((file) => fileDiff({ file, columns, palette, linkFile })).join('\n\n');
  }

  const number = /^#?(\d+)$/.exec(target)?.[1];

  if (number !== undefined) {
    return editDiff({ edits, number: Number(number), columns, palette, linkFile });
  }

  return matchFile({ files, target, columns, palette, linkFile });
}

function totalsByFile(edits: readonly FileEdit[]): FileTotal[] {
  const totals = new Map<string, FileTotal>();

  for (const edit of edits) {
    const total = totals.get(edit.path);

    if (total === undefined) {
      totals.set(edit.path, {
        path: edit.path,
        edits: [edit],
        before: edit.before,
        after: edit.after,
      });
    } else {
      total.edits.push(edit);
      total.after = edit.after;
    }
  }

  return [...totals.values()];
}

function fileList(params: {
  files: readonly FileTotal[];
  palette: Palette;
  linkFile: LinkFile;
}): string {
  const { files, palette, linkFile } = params;
  const { secondary } = palette.paint.text;
  const width = Math.max(...files.map(({ path }) => path.length));
  const totals = files.map((file) => ({ file, ...countChanges(file) }));
  const added = totals.reduce((sum, { added: count }) => sum + count, 0);
  const removed = totals.reduce((sum, { removed: count }) => sum + count, 0);
  const editCount = files.reduce((sum, { edits }) => sum + edits.length, 0);
  const rows = totals.map(({ file, ...changed }) => {
    const numbers = file.edits.map(({ number }) => `#${number}`).join(' ');
    const created = file.before === null ? secondary('  new') : '';

    const path = `${linkFile(file.path)}${' '.repeat(width - file.path.length)}`;

    return `  ${path}  ${counts({ ...changed, palette })}  ${secondary(numbers)}${created}`;
  });

  return [
    `${bold('File changes in this chat')}: ${plural({ count: files.length, word: 'file' })}, ` +
      `${plural({ count: editCount, word: 'edit' })}, ${counts({ added, removed, palette })}`,
    ...rows,
    secondary('/changes <file> or /changes #<n> shows a diff; /changes all shows every file.'),
  ].join('\n');
}

function editDiff(params: {
  edits: readonly FileEdit[];
  number: number;
  columns: number;
  palette: Palette;
  linkFile: LinkFile;
}): string {
  const { edits, number, columns, palette, linkFile } = params;
  const { text } = palette.paint;
  const edit = edits.find((candidate) => candidate.number === number);

  if (edit === undefined) return `No change #${number}; /changes lists them.`;

  const head = `${text.accent('▾')} ${linkFile(edit.path)} ${text.secondary(`· #${edit.number}`)} ${counts({ ...edit, palette })}`;

  return `${head}\n${diffBody({ before: edit.before, after: edit.after, columns, palette })}`;
}

function matchFile(params: {
  files: readonly FileTotal[];
  target: string;
  columns: number;
  palette: Palette;
  linkFile: LinkFile;
}): string {
  const { files, target, columns, palette, linkFile } = params;
  const exact = files.filter(({ path }) => path === target);
  const found = exact.length > 0 ? exact : files.filter(({ path }) => path.endsWith(`/${target}`));
  const [file, ...others] = found;

  if (file === undefined) return `No changes to ${plainTerminalText(target)}; /changes lists them.`;

  if (others.length > 0) {
    const paths = found.map(({ path }) => plainTerminalText(path)).join(', ');

    return `${plainTerminalText(target)} matches ${paths}; give more of the path.`;
  }

  return fileDiff({ file, columns, palette, linkFile });
}

/** A file's header, then what all its edits came to: from before the first to after the last. */
function fileDiff(params: {
  file: FileTotal;
  columns: number;
  palette: Palette;
  linkFile: LinkFile;
}): string {
  const { file, columns, palette, linkFile } = params;
  const { path, edits, before, after } = file;
  const { text } = palette.paint;
  const numbers = edits.map(({ number }) => `#${number}`).join(' ');
  const total = counts({ ...countChanges(file), palette });
  const head = `${text.accent('▾')} ${linkFile(path)} ${text.secondary(`· ${numbers}`)} ${total}`;

  return `${head}\n${diffBody({ before, after, columns, palette })}`;
}

function diffBody(params: {
  before: string | null;
  after: string;
  columns: number;
  palette: Palette;
}): string {
  const { before, after, columns, palette } = params;
  const rows = buildDiff({ before, after, maxRows: DIFF_EXPANDED_ROWS });

  if (rows.length === 0) return `    ${palette.paint.text.secondary('no net change')}`;

  return formatDiff({ rows, columns, palette }).trimEnd();
}

function counts(params: { added: number; removed: number; palette: Palette }): string {
  const { added, removed, palette } = params;

  return `${palette.paint.diff.added(`+${added}`)} ${palette.paint.diff.removed(`−${removed}`)}`;
}

function plural(params: { count: number; word: string }): string {
  const { count, word } = params;

  return `${count} ${count === 1 ? word : `${word}s`}`;
}
