import { bold } from '../render/style.utils.js';
import { defaultPalette } from '../theme/palette.utils.js';
import type { Palette } from '../theme/theme.types.js';
import { FAILURE_HEAD_LINES, FAILURE_TAIL_LINES } from './failures.constants.js';
import type { Failure } from './failures.types.js';
import { plainTerminalText } from '../render/terminal-text.utils.js';

const NOTHING = 'No failed steps with more to say in this chat yet.';

/** The line under a failed step's result that stands for its whole message, which `/errors` shows. */
export function collapsedFailure(params: { failure: Failure; palette?: Palette }): string {
  const { failure, palette = defaultPalette } = params;
  const { secondary } = palette.paint.text;
  const more =
    failure.moreLines === 0
      ? 'full message'
      : `${failure.moreLines} more ${failure.moreLines === 1 ? 'line' : 'lines'}`;

  return `    ${secondary('▸')} ${secondary(`${more} · /errors ${failure.number}`)}\n`;
}

/**
 * What `/errors <target>` shows. Nothing typed lists the failures; a number (with or without
 * `#`) shows one failure's whole message. A target that matches nothing says what to type.
 */
export function failuresText(params: {
  failures: readonly Failure[];
  target: string | undefined;
  /** The colours it is drawn in; the default theme's if none. */
  palette?: Palette;
}): string {
  const { failures, target, palette = defaultPalette } = params;

  if (failures.length === 0) return NOTHING;

  if (target === undefined) return failureList({ failures, palette });

  const number = /^#?(\d+)$/.exec(target)?.[1];

  if (number === undefined) {
    return `${plainTerminalText(target)} is not a failure; /errors lists them.`;
  }

  const failure = failures.find((candidate) => candidate.number === Number(number));

  if (failure === undefined) return `No failure #${number}; /errors lists them.`;

  return failureDetail({ failure, palette });
}

function failureList(params: { failures: readonly Failure[]; palette: Palette }): string {
  const { failures, palette } = params;
  const { text, status } = palette.paint;
  const rows = failures.map(
    ({ number, title, summary }) =>
      `  ${text.secondary(`#${number}`)}  ${plainTerminalText(title)}: ${status.error(plainTerminalText(summary))}`,
  );

  return [
    `${bold('Failed steps in this chat')}: ${failures.length}`,
    ...rows,
    text.secondary('/errors #<n> shows one in full.'),
  ].join('\n');
}

function failureDetail(params: { failure: Failure; palette: Palette }): string {
  const { failure, palette } = params;
  const { text, status } = palette.paint;
  const head = `${status.error('▾')} ${plainTerminalText(failure.title)} ${text.secondary(`· #${failure.number}`)}`;
  const lines = failure.content.split('\n');
  const shown = FAILURE_HEAD_LINES + FAILURE_TAIL_LINES;

  if (lines.length <= shown) return [head, ...lines.map(indent)].join('\n');

  const hidden = lines.length - shown;

  return [
    head,
    ...lines.slice(0, FAILURE_HEAD_LINES).map(indent),
    `    ${text.secondary(`… ${hidden} lines not shown …`)}`,
    ...lines.slice(-FAILURE_TAIL_LINES).map(indent),
  ].join('\n');
}

function indent(line: string): string {
  return `    ${plainTerminalText(line)}`;
}
